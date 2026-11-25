use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillItem {
    pub id: String,
    pub name: String,
    #[serde(rename = "amountVnd")]
    pub amount_vnd: i64,
    /// "all" splits evenly across all `participant_ids`; "selected" splits evenly across `member_ids`.
    pub scope: String,
    #[serde(default, rename = "memberIds")]
    pub member_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillShare {
    #[serde(rename = "userId")]
    pub user_id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "amountVnd")]
    pub amount_vnd: i64,
    /// Only populated in API responses when the requester is the bill creator.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paid: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SplitBill {
    pub id: String,
    #[serde(rename = "calendarId")]
    pub calendar_id: String,
    #[serde(rename = "creatorId")]
    pub creator_id: String,
    #[serde(rename = "creatorName")]
    pub creator_name: String,
    pub title: String,
    #[serde(rename = "bankBin")]
    pub bank_bin: String,
    #[serde(rename = "bankAccountNumber")]
    pub bank_account_number: String,
    #[serde(rename = "participantIds")]
    pub participant_ids: Vec<String>,
    pub items: Vec<BillItem>,
    pub shares: Vec<BillShare>,
    #[serde(rename = "totalVnd")]
    pub total_vnd: i64,
    #[serde(rename = "createdAt")]
    pub created_at: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateBillItemInput {
    pub name: String,
    #[serde(rename = "amountVnd")]
    pub amount_vnd: i64,
    pub scope: String,
    #[serde(default, rename = "memberIds")]
    pub member_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateBillRequest {
    #[serde(rename = "calendarId")]
    pub calendar_id: String,
    pub title: String,
    #[serde(rename = "participantIds")]
    pub participant_ids: Vec<String>,
    pub items: Vec<CreateBillItemInput>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SetBillPaidRequest {
    #[serde(rename = "userId")]
    pub user_id: String,
    pub paid: bool,
}
