use crate::models::event::ScheduleEvent;
use crate::models::notification::{PushSubscriptionRecord, SseNotificationEvent};
use crate::repositories::calendar_repo::CalendarRepository;
use crate::repositories::event_repo::EventRepository;
use crate::repositories::now_sec;
use crate::repositories::push_repo::PushRepository;
use crate::services::push_service::{PushPayload, PushService};
use crate::services::sse_service::SseService;
use chrono::{DateTime, Datelike, Duration as ChronoDuration, TimeZone, Utc};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::time::{Duration, sleep};
use tracing::{info, warn};

pub struct ReminderScheduler<ER: EventRepository, CR: CalendarRepository, PR: PushRepository> {
    event_repo: ER,
    cal_repo: CR,
    push_repo: PR,
    push_svc: PushService<PR>,
    sse_svc: SseService,
    frontend_url: String,
}

impl<ER, CR, PR> ReminderScheduler<ER, CR, PR>
where
    ER: EventRepository + 'static,
    CR: CalendarRepository + 'static,
    PR: PushRepository + 'static,
{
    pub fn new(
        event_repo: ER,
        cal_repo: CR,
        push_repo: PR,
        push_svc: PushService<PR>,
        sse_svc: SseService,
        frontend_url: String,
    ) -> Self {
        Self {
            event_repo,
            cal_repo,
            push_repo,
            push_svc,
            sse_svc,
            frontend_url: frontend_url.trim_end_matches('/').to_string(),
        }
    }

    pub fn start_background_loop(self: Arc<Self>) {
        tokio::spawn(async move {
            info!("ReminderScheduler background loop started (interval: 30s)");
            loop {
                if let Err(e) = self.check_upcoming_reminders().await {
                    warn!(error = %e, "ReminderScheduler cycle failed");
                }
                sleep(Duration::from_secs(30)).await;
            }
        });
    }

    pub async fn notify_event_created(&self, event: &ScheduleEvent) {
        self.sse_svc.broadcast(SseNotificationEvent {
            kind: "event_created".to_string(),
            calendar_id: event.calendar_id.clone(),
            event_id: event.id.clone(),
            title: Some(event.title.clone()),
            message: Some("New event scheduled".to_string()),
            timestamp: now_sec(),
        });

        let recipient_ids = self.resolve_recipient_ids(event, Some(&event.organizer_id)).await;
        let subs = self.collect_subscriptions(event, &recipient_ids).await;
        let organizer = event.organizer_name.as_deref().unwrap_or("Someone");

        let payload = PushPayload {
            title: format!("New Invite: {}", event.title),
            body: format!("{} invited you · Tap to view & RSVP", organizer),
            url: format!("{}/e/{}", self.frontend_url, event.share_token),
            tag: format!("invite-{}", event.id),
        };

        let sent = self.push_svc.dispatch_to_subscriptions(&subs, &payload).await;
        if sent > 0 {
            info!(event_id = %event.id, sent, "Dispatched new event invitation Web Push");
        }
    }

    pub async fn notify_event_updated(
        &self,
        old_event: &ScheduleEvent,
        updated_event: &ScheduleEvent,
        editor_id: &str,
    ) {
        self.sse_svc.broadcast(SseNotificationEvent {
            kind: "event_updated".to_string(),
            calendar_id: updated_event.calendar_id.clone(),
            event_id: updated_event.id.clone(),
            title: Some(updated_event.title.clone()),
            message: Some("Event updated".to_string()),
            timestamp: now_sec(),
        });

        let time_changed = old_event.start != updated_event.start
            || old_event.duration_minutes != updated_event.duration_minutes
            || serde_json::to_string(&old_event.recurrence).unwrap_or_default()
                != serde_json::to_string(&updated_event.recurrence).unwrap_or_default();

        if time_changed {
            let _ = self.push_repo.clear_event_reminders(&updated_event.id).await;
            let recipient_ids = self.resolve_recipient_ids(updated_event, Some(editor_id)).await;
            let subs = self.collect_subscriptions(updated_event, &recipient_ids).await;
            let payload = PushPayload {
                title: format!("Rescheduled: {}", updated_event.title),
                body: "The time or schedule was updated. Tap to check details.".to_string(),
                url: format!("{}/e/{}", self.frontend_url, updated_event.share_token),
                tag: format!("update-{}", updated_event.id),
            };
            let _ = self.push_svc.dispatch_to_subscriptions(&subs, &payload).await;
        }
    }

    pub async fn notify_event_deleted(
        &self,
        event: &ScheduleEvent,
        actor_id: &str,
        actor_name: &str,
        occurrence: Option<&str>,
    ) {
        let body = match occurrence {
            Some(occ) => format!("{actor_name} cancelled the {occ} occurrence"),
            None => format!("{actor_name} cancelled this event"),
        };

        self.sse_svc.broadcast(SseNotificationEvent {
            kind: "event_deleted".to_string(),
            calendar_id: event.calendar_id.clone(),
            event_id: event.id.clone(),
            title: Some(event.title.clone()),
            message: Some(body.clone()),
            timestamp: now_sec(),
        });

        let recipient_ids = self.resolve_recipient_ids(event, Some(actor_id)).await;
        if recipient_ids.is_empty() {
            return;
        }
        let subs = self.collect_subscriptions(event, &recipient_ids).await;
        if subs.is_empty() {
            return;
        }

        let url = if occurrence.is_some() {
            format!("{}/e/{}", self.frontend_url, event.share_token)
        } else {
            self.frontend_url.clone()
        };

        let payload = PushPayload {
            title: format!("Cancelled: {}", event.title),
            body,
            url,
            tag: format!("cancel-{}", event.id),
        };

        let sent = self.push_svc.dispatch_to_subscriptions(&subs, &payload).await;
        if sent > 0 {
            info!(event_id = %event.id, sent, "Dispatched event cancellation Web Push");
        }
    }

    pub async fn notify_rsvp_updated(
        &self,
        event: &ScheduleEvent,
        responder_id: &str,
        responder_name: &str,
        status: &str,
    ) {
        let verb = match status {
            "accepted" => "accepted",
            "tentative" => "tentatively accepted",
            "declined" => "declined",
            _ => "responded to",
        };
        let body = format!("{responder_name} {verb} your event");

        self.sse_svc.broadcast(SseNotificationEvent {
            kind: "rsvp_updated".to_string(),
            calendar_id: event.calendar_id.clone(),
            event_id: event.id.clone(),
            title: Some(event.title.clone()),
            message: Some(body.clone()),
            timestamp: now_sec(),
        });

        if event.organizer_id.is_empty() || responder_id == event.organizer_id {
            return;
        }

        let Ok(subs) = self
            .push_repo
            .list_subscriptions_for_users(&[event.organizer_id.clone()])
            .await
        else {
            return;
        };
        if subs.is_empty() {
            return;
        }

        let payload = PushPayload {
            title: format!("RSVP: {}", event.title),
            body,
            url: format!("{}/e/{}", self.frontend_url, event.share_token),
            tag: format!("rsvp-{}-{}", event.id, responder_id),
        };

        let sent = self.push_svc.dispatch_to_subscriptions(&subs, &payload).await;
        if sent > 0 {
            info!(event_id = %event.id, organizer_id = %event.organizer_id, sent, "Dispatched RSVP notification Web Push");
        }
    }

    async fn check_upcoming_reminders(self: &Arc<Self>) -> Result<(), String> {
        let events = self
            .event_repo
            .list_all_active_events()
            .await
            .map_err(|e| e.to_string())?;
        let now = Utc::now();

        for ev in events {
            let occurrences = upcoming_occurrences(&ev, now);
            for (occ_key, occ_start) in occurrences {
                let diff_mins = (occ_start - now).num_minutes();

                // 1. 15-minute lead reminder
                if diff_mins > 0 && diff_mins <= 15 {
                    let already = self
                        .push_repo
                        .is_occurrence_reminded(&ev.id, &occ_key, "lead")
                        .await
                        .unwrap_or(true);
                    if !already {
                        let _ = self
                            .push_repo
                            .mark_occurrence_reminded(&ev.id, &occ_key, "lead")
                            .await;
                        let svc = Arc::clone(self);
                        let ev_c = ev.clone();
                        let key_c = occ_key.clone();
                        tokio::spawn(async move {
                            svc.send_occurrence_reminder(&ev_c, &key_c, diff_mins, "lead")
                                .await;
                        });
                    }
                }

                // 2. Starting now reminder
                if (-2..=0).contains(&diff_mins) {
                    let already = self
                        .push_repo
                        .is_occurrence_reminded(&ev.id, &occ_key, "start")
                        .await
                        .unwrap_or(true);
                    if !already {
                        let _ = self
                            .push_repo
                            .mark_occurrence_reminded(&ev.id, &occ_key, "start")
                            .await;
                        let svc = Arc::clone(self);
                        let ev_c = ev.clone();
                        let key_c = occ_key.clone();
                        tokio::spawn(async move {
                            svc.send_occurrence_reminder(&ev_c, &key_c, 0, "start")
                                .await;
                        });
                    }
                }
            }
        }
        Ok(())
    }

    async fn send_occurrence_reminder(
        &self,
        event: &ScheduleEvent,
        occ_key: &str,
        lead_mins: i64,
        r_type: &str,
    ) {
        let recipient_ids = self.resolve_non_declined_recipients(event, occ_key).await;
        let subs = self.collect_subscriptions(event, &recipient_ids).await;

        let (title, body) = if r_type == "start" {
            (
                format!("Starting Now: {}", event.title),
                "Your scheduled event is starting right now!".to_string(),
            )
        } else {
            (
                format!("In {} min: {}", lead_mins, event.title),
                format!("{} starts in {} minutes.", event.title, lead_mins),
            )
        };

        self.sse_svc.broadcast(SseNotificationEvent {
            kind: "reminder".to_string(),
            calendar_id: event.calendar_id.clone(),
            event_id: event.id.clone(),
            title: Some(title.clone()),
            message: Some(body.clone()),
            timestamp: now_sec(),
        });

        let payload = PushPayload {
            title,
            body,
            url: format!("{}/e/{}", self.frontend_url, event.share_token),
            tag: format!("rem-{}-{}-{}", event.id, occ_key, r_type),
        };

        let sent = self.push_svc.dispatch_to_subscriptions(&subs, &payload).await;
        info!(
            event_id = %event.id,
            occ_key = %occ_key,
            reminder_type = %r_type,
            sent,
            "Reminder cycle dispatched"
        );
    }

    async fn resolve_recipient_ids(
        &self,
        event: &ScheduleEvent,
        exclude_user_id: Option<&str>,
    ) -> Vec<String> {
        let member_ids: HashSet<String> = self
            .cal_repo
            .list_member_infos(&event.calendar_id)
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|m| m.id)
            .collect();

        let mut set = HashSet::new();
        if !event.organizer_id.is_empty() && member_ids.contains(&event.organizer_id) {
            set.insert(event.organizer_id.clone());
        }
        if event.invite_everyone {
            set.extend(member_ids);
        } else {
            for uid in &event.invitee_ids {
                if member_ids.contains(uid) {
                    set.insert(uid.clone());
                }
            }
        }
        if let Some(ex) = exclude_user_id {
            set.remove(ex);
        }
        set.into_iter().collect()
    }

    async fn resolve_non_declined_recipients(
        &self,
        event: &ScheduleEvent,
        occ_key: &str,
    ) -> Vec<String> {
        let all = self.resolve_recipient_ids(event, None).await;
        all.into_iter()
            .filter(|uid| {
                let series_declined = event
                    .series_responses
                    .get(uid)
                    .and_then(|v| v.as_str())
                    == Some("declined");
                let occ_declined = event
                    .occurrence_responses
                    .get(occ_key)
                    .and_then(|o| o.get(uid))
                    .and_then(|v| v.as_str())
                    == Some("declined");
                !series_declined && !occ_declined
            })
            .collect()
    }

    async fn collect_subscriptions(
        &self,
        event: &ScheduleEvent,
        user_ids: &[String],
    ) -> Vec<PushSubscriptionRecord> {
        let mut by_endpoint: HashMap<String, PushSubscriptionRecord> = HashMap::new();

        if let Ok(user_subs) = self.push_repo.list_subscriptions_for_users(user_ids).await {
            for s in user_subs {
                by_endpoint.insert(s.endpoint.clone(), s);
            }
        }
        if let Ok(ev_subs) = self.push_repo.list_subscriptions_for_event(&event.id).await {
            for s in ev_subs {
                by_endpoint.insert(s.endpoint.clone(), s);
            }
        }

        by_endpoint.into_values().collect()
    }
}

/// Computes occurrences of `event` falling near `now` (within [-5m, +20m]) for reminder checks.
pub fn upcoming_occurrences(event: &ScheduleEvent, now: DateTime<Utc>) -> Vec<(String, DateTime<Utc>)> {
    let Ok(first_fixed) = DateTime::parse_from_rfc3339(&event.start) else {
        return Vec::new();
    };
    let first = first_fixed.with_timezone(&Utc);
    let win_start = now - ChronoDuration::minutes(5);
    let win_end = now + ChronoDuration::minutes(20);

    let key_for = |dt: DateTime<Utc>| dt.format("%Y-%m-%d").to_string();

    let Some(rec) = &event.recurrence else {
        let k = key_for(first);
        if first >= win_start
            && first <= win_end
            && !event.cancelled_occurrences.contains(&k)
        {
            return vec![(k, first)];
        }
        return Vec::new();
    };

    let interval = rec.interval.max(1) as i64;
    let first_date = first.date_naive();
    let time = first.time();
    let until_date = rec
        .until
        .as_deref()
        .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());

    let mut out = Vec::new();
    let mut produced = 0i32;

    for i in 0..=3660i64 {
        let day = first_date + ChronoDuration::days(i);
        if let Some(u) = until_date {
            if day > u {
                break;
            }
        }
        let naive_dt = day.and_time(time);
        let dt = Utc.from_utc_datetime(&naive_dt);
        if dt > win_end {
            break;
        }

        let matches = match rec.freq.as_str() {
            "daily" => i % interval == 0,
            "weekly" => {
                let wd = day.weekday().num_days_from_sunday() as i32;
                let default_wd = first_date.weekday().num_days_from_sunday() as i32;
                let allowed = rec
                    .weekdays
                    .as_ref()
                    .filter(|w| !w.is_empty())
                    .map(|w| w.contains(&wd))
                    .unwrap_or(wd == default_wd);
                let week_diff = (day - first_date).num_days() / 7;
                allowed && (week_diff % interval == 0)
            }
            "monthly" => {
                let months_diff =
                    (day.year() - first_date.year()) * 12 + (day.month() as i32 - first_date.month() as i32);
                day.day() == first_date.day() && (months_diff as i64 % interval == 0)
            }
            _ => false,
        };

        if !matches {
            continue;
        }
        produced += 1;
        if let Some(max_count) = rec.count {
            if produced > max_count {
                break;
            }
        }

        let k = key_for(dt);
        if dt >= win_start && dt <= win_end && !event.cancelled_occurrences.contains(&k) {
            out.push((k, dt));
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::event::ScheduleEventRecurrence;

    fn sample_event(start: &str, rec: Option<ScheduleEventRecurrence>) -> ScheduleEvent {
        ScheduleEvent {
            id: "ev-1".to_string(),
            calendar_id: "cal-1".to_string(),
            share_token: "tok123".to_string(),
            title: "Friday Hangout".to_string(),
            description: String::new(),
            category: Some("other".to_string()),
            start: start.to_string(),
            duration_minutes: 60,
            recurrence: rec,
            location: None,
            image_url: None,
            links: vec![],
            organizer_id: "u1".to_string(),
            organizer_name: Some("Alex".to_string()),
            organizer_avatar: None,
            invite_everyone: true,
            invitee_ids: vec![],
            series_responses: serde_json::json!({}),
            occurrence_responses: serde_json::json!({}),
            guest_names: serde_json::json!({}),
            cancelled_occurrences: vec![],
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn one_off_occurrence_matches_lead_window() {
        let now = Utc.with_ymd_and_hms(2026, 11, 18, 10, 0, 0).unwrap();
        let ev = sample_event("2026-11-18T10:15:00Z", None);
        let occs = upcoming_occurrences(&ev, now);
        assert_eq!(occs.len(), 1);
        assert_eq!(occs[0].0, "2026-11-18");
    }

    #[test]
    fn recurring_daily_respects_cancelled_occurrences() {
        let now = Utc.with_ymd_and_hms(2026, 11, 20, 10, 0, 0).unwrap();
        let mut ev = sample_event(
            "2026-11-18T10:10:00Z",
            Some(ScheduleEventRecurrence {
                freq: "daily".to_string(),
                interval: 1,
                weekdays: None,
                until: None,
                count: None,
            }),
        );
        assert_eq!(upcoming_occurrences(&ev, now).len(), 1);
        ev.cancelled_occurrences.push("2026-11-20".to_string());
        assert_eq!(upcoming_occurrences(&ev, now).len(), 0);
    }
}
