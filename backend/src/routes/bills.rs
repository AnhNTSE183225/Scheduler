use crate::error::AppError;
use crate::models::bill::{BillItem, BillShare, CreateBillRequest, SetBillPaidRequest, SplitBill};
use crate::models::state::StateMachineDTO;
use crate::repositories::bill_repo::BillRepository;
use crate::repositories::calendar_repo::CalendarRepository;
use crate::repositories::now_sec;
use crate::routes::require_session;
use crate::state::AppState;
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
    response::IntoResponse,
};
use serde_json::json;
use std::collections::{HashMap, HashSet};

fn redact_bill_for_viewer(mut bill: SplitBill, viewer_id: &str) -> SplitBill {
    if bill.creator_id != viewer_id {
        for s in &mut bill.shares {
            s.paid = None;
        }
    }
    bill
}

pub async fn list_bills(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let session = require_session(&headers, &state).await?;
    let bills = state
        .bill_repo
        .list_bills_for_user(&session.user.id)
        .await?
        .into_iter()
        .map(|b| redact_bill_for_viewer(b, &session.user.id))
        .collect::<Vec<_>>();

    Ok(Json(StateMachineDTO::active(json!({ "bills": bills }))))
}

pub async fn get_bill(
    Path(bill_id): Path<String>,
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let session = require_session(&headers, &state).await?;
    let bill = state
        .bill_repo
        .get_bill(&bill_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Split bill not found".to_string()))?;

    let is_involved =
        bill.creator_id == session.user.id || bill.participant_ids.iter().any(|id| id == &session.user.id);
    if !is_involved {
        return Err(AppError::Forbidden("You do not have access to this split bill".to_string()));
    }

    Ok(Json(StateMachineDTO::active(json!({
        "bill": redact_bill_for_viewer(bill, &session.user.id)
    }))))
}

pub async fn create_bill(
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(payload): Json<CreateBillRequest>,
) -> Result<impl IntoResponse, AppError> {
    let session = require_session(&headers, &state).await?;

    let bank_bin = session
        .user
        .bank_bin
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::BadRequest(
                "Please set your Bank and Bank Account Number in Profile before creating a Split Bill."
                    .to_string(),
            )
        })?
        .to_string();
    let bank_account_number = session
        .user
        .bank_account_number
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::BadRequest(
                "Please set your Bank and Bank Account Number in Profile before creating a Split Bill."
                    .to_string(),
            )
        })?
        .to_string();

    if !state
        .cal_repo
        .is_member(&payload.calendar_id, &session.user.id)
        .await?
    {
        return Err(AppError::Forbidden(
            "You do not belong to this calendar".to_string(),
        ));
    }

    let title = payload.title.trim().to_string();
    if title.is_empty() || title.chars().count() > 120 {
        return Err(AppError::BadRequest(
            "Bill title must be between 1 and 120 characters".to_string(),
        ));
    }
    if payload.items.is_empty() || payload.items.len() > 100 {
        return Err(AppError::BadRequest(
            "Add between 1 and 100 expense items".to_string(),
        ));
    }

    let members = state.cal_repo.list_member_infos(&payload.calendar_id).await?;
    let member_names: HashMap<String, String> =
        members.into_iter().map(|m| (m.id, m.name)).collect();

    let mut participant_set = HashSet::new();
    let mut participant_ids = Vec::new();
    for uid in &payload.participant_ids {
        if member_names.contains_key(uid) && participant_set.insert(uid.clone()) {
            participant_ids.push(uid.clone());
        }
    }
    if participant_ids.is_empty() {
        return Err(AppError::BadRequest(
            "Select at least one calendar member to split with".to_string(),
        ));
    }

    let mut items = Vec::with_capacity(payload.items.len());
    let mut owed: HashMap<String, i64> = participant_ids.iter().map(|id| (id.clone(), 0)).collect();
    let mut total_vnd: i64 = 0;

    for raw in &payload.items {
        let name = raw.name.trim().to_string();
        if name.is_empty() || name.chars().count() > 120 {
            return Err(AppError::BadRequest(
                "Each expense item must have a name (1-120 characters)".to_string(),
            ));
        }
        if raw.amount_vnd <= 0 || raw.amount_vnd > 1_000_000_000_000 {
            return Err(AppError::BadRequest(format!(
                "Expense '{name}' must be between 1 and 1,000,000,000,000 VND"
            )));
        }

        let scope = if raw.scope == "selected" {
            "selected".to_string()
        } else {
            "all".to_string()
        };

        let targets: Vec<String> = if scope == "all" {
            participant_ids.clone()
        } else {
            let mut seen = HashSet::new();
            let mut list = Vec::new();
            for mid in &raw.member_ids {
                if member_names.contains_key(mid) && seen.insert(mid.clone()) {
                    list.push(mid.clone());
                    if participant_set.insert(mid.clone()) {
                        participant_ids.push(mid.clone());
                        owed.entry(mid.clone()).or_insert(0);
                    }
                }
            }
            if list.is_empty() {
                return Err(AppError::BadRequest(format!(
                    "Select at least one person for '{name}'"
                )));
            }
            list
        };

        let n = targets.len() as i64;
        let base = raw.amount_vnd / n;
        let rem = raw.amount_vnd % n;
        for (idx, uid) in targets.iter().enumerate() {
            let extra = if (idx as i64) < rem { 1 } else { 0 };
            let entry = owed.entry(uid.clone()).or_insert(0);
            *entry = entry
                .checked_add(base + extra)
                .ok_or_else(|| AppError::BadRequest("Share amount overflow".to_string()))?;
        }
        total_vnd = total_vnd
            .checked_add(raw.amount_vnd)
            .ok_or_else(|| AppError::BadRequest("Total bill amount overflow".to_string()))?;

        let is_selected = scope == "selected";
        items.push(BillItem {
            id: format!("item-{}", uuid::Uuid::new_v4().simple()),
            name,
            amount_vnd: raw.amount_vnd,
            scope,
            member_ids: if is_selected { targets } else { Vec::new() },
        });
    }

    let shares: Vec<BillShare> = participant_ids
        .iter()
        .map(|uid| BillShare {
            user_id: uid.clone(),
            display_name: member_names
                .get(uid)
                .cloned()
                .unwrap_or_else(|| "Member".to_string()),
            amount_vnd: *owed.get(uid).unwrap_or(&0),
            paid: Some(uid == &session.user.id),
        })
        .collect();

    let bill = SplitBill {
        id: format!("bill-{}", uuid::Uuid::new_v4().simple()),
        calendar_id: payload.calendar_id,
        creator_id: session.user.id.clone(),
        creator_name: session.user.display_name.clone(),
        title,
        bank_bin,
        bank_account_number,
        participant_ids,
        items,
        shares,
        total_vnd,
        created_at: now_sec(),
    };

    state.bill_repo.create_bill(&bill).await?;

    let svc = state.reminder_svc.clone();
    let bill_clone = bill.clone();
    tokio::spawn(async move {
        svc.notify_bill_created(&bill_clone).await;
    });

    Ok(Json(StateMachineDTO::active(json!({ "bill": bill }))))
}

pub async fn set_bill_paid(
    Path(bill_id): Path<String>,
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(payload): Json<SetBillPaidRequest>,
) -> Result<impl IntoResponse, AppError> {
    let session = require_session(&headers, &state).await?;
    let mut bill = state
        .bill_repo
        .get_bill(&bill_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Split bill not found".to_string()))?;

    if bill.creator_id != session.user.id {
        return Err(AppError::Forbidden(
            "Only the bill creator can update payment status".to_string(),
        ));
    }

    let mut found = false;
    for s in &mut bill.shares {
        if s.user_id == payload.user_id {
            s.paid = Some(payload.paid);
            found = true;
            break;
        }
    }
    if !found {
        return Err(AppError::NotFound("Participant not found in bill".to_string()));
    }

    state.bill_repo.update_shares(&bill.id, &bill.shares).await?;
    Ok(Json(StateMachineDTO::active(json!({ "bill": bill }))))
}

pub async fn delete_bill(
    Path(bill_id): Path<String>,
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let session = require_session(&headers, &state).await?;
    let bill = state
        .bill_repo
        .get_bill(&bill_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Split bill not found".to_string()))?;

    if bill.creator_id != session.user.id {
        return Err(AppError::Forbidden(
            "Only the bill creator can delete this split bill".to_string(),
        ));
    }

    state.bill_repo.delete_bill(&bill.id).await?;
    Ok(Json(StateMachineDTO::active(json!({ "deleted": true }))))
}
