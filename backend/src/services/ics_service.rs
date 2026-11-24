use crate::models::event::ScheduleEvent;
use chrono::{DateTime, Duration, Utc};

fn escape_ics(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace(',', "\\,")
        .replace(';', "\\;")
}

/// Generates a standard RFC 5545 `.ics` calendar file for native OS calendar import.
pub fn build_ics(event: &ScheduleEvent, event_url: &str) -> String {
    let start_utc = DateTime::parse_from_rfc3339(&event.start)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now());
    let end_utc = start_utc + Duration::minutes(event.duration_minutes as i64);
    let now_utc = Utc::now();

    let fmt = "%Y%m%dT%H%M%SZ";
    let location_str = match &event.location {
        Some(loc) if loc.kind == "address" => loc.address.clone().unwrap_or_default(),
        Some(loc) if loc.kind == "link" => loc.url.clone().unwrap_or_default(),
        _ => String::new(),
    };

    let mut desc = event.description.clone();
    if !desc.is_empty() {
        desc.push_str("\n\n");
    }
    desc.push_str(&format!("RSVP & Details: {}", event_url));

    let mut lines = vec![
        "BEGIN:VCALENDAR".to_string(),
        "VERSION:2.0".to_string(),
        "PRODID:-//PulsePlan Scheduler//EN".to_string(),
        "CALSCALE:GREGORIAN".to_string(),
        "METHOD:PUBLISH".to_string(),
        "BEGIN:VEVENT".to_string(),
        format!("UID:{}@pulseplan.local", event.id),
        format!("DTSTAMP:{}", now_utc.format(fmt)),
        format!("DTSTART:{}", start_utc.format(fmt)),
        format!("DTEND:{}", end_utc.format(fmt)),
        format!("SUMMARY:{}", escape_ics(&event.title)),
        format!("DESCRIPTION:{}", escape_ics(&desc)),
        format!("URL:{}", event_url),
    ];

    if !location_str.is_empty() {
        lines.push(format!("LOCATION:{}", escape_ics(&location_str)));
    }

    if let Some(rec) = &event.recurrence {
        let freq = match rec.freq.as_str() {
            "daily" => "DAILY",
            "weekly" => "WEEKLY",
            "monthly" => "MONTHLY",
            _ => "",
        };
        if !freq.is_empty() {
            let mut rrule = format!("RRULE:FREQ={};INTERVAL={}", freq, rec.interval.max(1));
            if let Some(count) = rec.count {
                rrule.push_str(&format!(";COUNT={}", count.max(1)));
            } else if let Some(until) = &rec.until {
                if let Ok(d) = chrono::NaiveDate::parse_from_str(until, "%Y-%m-%d") {
                    rrule.push_str(&format!(";UNTIL={}T235959Z", d.format("%Y%m%d")));
                }
            }
            lines.push(rrule);
        }
    }

    lines.push("BEGIN:VALARM".to_string());
    lines.push("TRIGGER:-PT15M".to_string());
    lines.push("ACTION:DISPLAY".to_string());
    lines.push(format!("DESCRIPTION:Reminder: {}", escape_ics(&event.title)));
    lines.push("END:VALARM".to_string());
    lines.push("END:VEVENT".to_string());
    lines.push("END:VCALENDAR".to_string());

    lines.join("\r\n")
}
