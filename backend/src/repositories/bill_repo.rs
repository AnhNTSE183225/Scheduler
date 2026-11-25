use crate::error::AppError;
use crate::models::bill::{BillItem, BillShare, SplitBill};
use sqlx::{Row, SqlitePool};
use std::future::Future;

pub trait BillRepository: Send + Sync {
    fn create_bill(&self, bill: &SplitBill) -> impl Future<Output = Result<(), AppError>> + Send;
    fn get_bill(&self, bill_id: &str) -> impl Future<Output = Result<Option<SplitBill>, AppError>> + Send;
    fn list_bills_for_user(
        &self,
        user_id: &str,
    ) -> impl Future<Output = Result<Vec<SplitBill>, AppError>> + Send;
    fn update_shares(
        &self,
        bill_id: &str,
        shares: &[BillShare],
    ) -> impl Future<Output = Result<(), AppError>> + Send;
    fn delete_bill(&self, bill_id: &str) -> impl Future<Output = Result<(), AppError>> + Send;
}

#[derive(Clone)]
pub struct SqliteBillRepository {
    pool: SqlitePool,
}

impl SqliteBillRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    fn row_to_bill(row: &sqlx::sqlite::SqliteRow) -> Result<SplitBill, AppError> {
        let participant_ids_json: String = row.get("participant_ids_json");
        let items_json: String = row.get("items_json");
        let shares_json: String = row.get("shares_json");

        let participant_ids: Vec<String> = serde_json::from_str(&participant_ids_json)
            .map_err(|e| AppError::Internal(format!("Corrupt participant_ids_json: {e}")))?;
        let items: Vec<BillItem> = serde_json::from_str(&items_json)
            .map_err(|e| AppError::Internal(format!("Corrupt items_json: {e}")))?;
        let shares: Vec<BillShare> = serde_json::from_str(&shares_json)
            .map_err(|e| AppError::Internal(format!("Corrupt shares_json: {e}")))?;

        Ok(SplitBill {
            id: row.get("id"),
            calendar_id: row.get("calendar_id"),
            creator_id: row.get("creator_id"),
            creator_name: row.get("creator_name"),
            title: row.get("title"),
            bank_bin: row.get("bank_bin"),
            bank_account_number: row.get("bank_account_number"),
            participant_ids,
            items,
            shares,
            total_vnd: row.get("total_vnd"),
            created_at: row.get("created_at"),
        })
    }
}

impl BillRepository for SqliteBillRepository {
    async fn create_bill(&self, bill: &SplitBill) -> Result<(), AppError> {
        let participant_ids_json = serde_json::to_string(&bill.participant_ids)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let items_json =
            serde_json::to_string(&bill.items).map_err(|e| AppError::Internal(e.to_string()))?;
        let shares_json =
            serde_json::to_string(&bill.shares).map_err(|e| AppError::Internal(e.to_string()))?;

        sqlx::query(
            r#"
            INSERT INTO split_bills (
                id, calendar_id, creator_id, creator_name, title,
                bank_bin, bank_account_number, participant_ids_json,
                items_json, shares_json, total_vnd, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&bill.id)
        .bind(&bill.calendar_id)
        .bind(&bill.creator_id)
        .bind(&bill.creator_name)
        .bind(&bill.title)
        .bind(&bill.bank_bin)
        .bind(&bill.bank_account_number)
        .bind(&participant_ids_json)
        .bind(&items_json)
        .bind(&shares_json)
        .bind(bill.total_vnd)
        .bind(bill.created_at)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn get_bill(&self, bill_id: &str) -> Result<Option<SplitBill>, AppError> {
        let row = sqlx::query(
            r#"
            SELECT id, calendar_id, creator_id, creator_name, title,
                   bank_bin, bank_account_number, participant_ids_json,
                   items_json, shares_json, total_vnd, created_at
            FROM split_bills
            WHERE id = ?
            LIMIT 1
            "#,
        )
        .bind(bill_id)
        .fetch_optional(&self.pool)
        .await?;

        row.as_ref().map(Self::row_to_bill).transpose()
    }

    async fn list_bills_for_user(&self, user_id: &str) -> Result<Vec<SplitBill>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT id, calendar_id, creator_id, creator_name, title,
                   bank_bin, bank_account_number, participant_ids_json,
                   items_json, shares_json, total_vnd, created_at
            FROM split_bills
            WHERE creator_id = ?
               OR EXISTS (
                   SELECT 1 FROM json_each(participant_ids_json)
                   WHERE json_each.value = ?
               )
            ORDER BY created_at DESC
            LIMIT 200
            "#,
        )
        .bind(user_id)
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        let mut bills = Vec::with_capacity(rows.len());
        for r in rows {
            bills.push(Self::row_to_bill(&r)?);
        }
        Ok(bills)
    }

    async fn update_shares(&self, bill_id: &str, shares: &[BillShare]) -> Result<(), AppError> {
        let shares_json =
            serde_json::to_string(shares).map_err(|e| AppError::Internal(e.to_string()))?;
        sqlx::query("UPDATE split_bills SET shares_json = ? WHERE id = ?")
            .bind(&shares_json)
            .bind(bill_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete_bill(&self, bill_id: &str) -> Result<(), AppError> {
        sqlx::query("DELETE FROM split_bills WHERE id = ?")
            .bind(bill_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
