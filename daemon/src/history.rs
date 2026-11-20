use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::VecDeque;

pub const HISTORY_LIMIT: usize = 256 * 1024;

/// Bounded UTF-8 output. Evict bytes before appending so steady-state
/// terminal output never shifts the entire history or grows its allocation.
#[derive(Clone, Default)]
pub struct History(VecDeque<u8>);

impl History {
    pub fn append(&mut self, text: &str) {
        if text.len() >= HISTORY_LIMIT {
            let mut start = text.len() - HISTORY_LIMIT;
            while !text.is_char_boundary(start) {
                start += 1;
            }
            self.0.clear();
            self.0.extend(text[start..].bytes());
            return;
        }
        let excess = self
            .0
            .len()
            .saturating_add(text.len())
            .saturating_sub(HISTORY_LIMIT);
        self.0.drain(..excess.min(self.0.len()));
        while self.0.front().is_some_and(|b| b & 0xc0 == 0x80) {
            self.0.pop_front();
        }
        self.0.extend(text.bytes());
    }
}

impl Serialize for History {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let (a, b) = self.0.as_slices();
        if b.is_empty() {
            let text = std::str::from_utf8(a).map_err(serde::ser::Error::custom)?;
            serializer.serialize_str(text)
        } else {
            let mut bytes = Vec::with_capacity(self.0.len());
            bytes.extend_from_slice(a);
            bytes.extend_from_slice(b);
            let text = std::str::from_utf8(&bytes).map_err(serde::ser::Error::custom)?;
            serializer.serialize_str(text)
        }
    }
}
impl<'de> Deserialize<'de> for History {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        // Old archives may have been capped in UTF-16 code units. Preserve
        // their complete contents until the next append, as before.
        let text = String::deserialize(deserializer)?;
        Ok(Self(VecDeque::from(text.into_bytes())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn expected(mut text: String) -> String {
        if text.len() > HISTORY_LIMIT {
            let mut start = text.len() - HISTORY_LIMIT;
            while !text.is_char_boundary(start) {
                start += 1;
            }
            text.drain(..start);
        }
        text
    }
    #[test]
    fn matches_old_suffix_and_json_across_wrap_and_oversize_append() {
        let mut history = History::default();
        let mut reference = String::new();
        for part in [
            "\u{4e2d}\u{6587}\u{1f680}".repeat(30000),
            "abc".repeat(300),
            "\u{1f680}".repeat(600),
            "x".repeat(HISTORY_LIMIT + 10),
        ] {
            history.append(&part);
            reference.push_str(&part);
            reference = expected(reference);
            assert_eq!(
                serde_json::to_value(&history).unwrap(),
                serde_json::json!(reference)
            );
        }
        let restored: History = serde_json::from_value(serde_json::json!(reference)).unwrap();
        assert_eq!(
            serde_json::to_value(restored).unwrap(),
            serde_json::json!(reference)
        );
    }
    #[test]
    fn legacy_oversized_utf8_archive_preserved_until_append() {
        let old = "\u{4e2d}".repeat(HISTORY_LIMIT);
        let mut history: History = serde_json::from_value(serde_json::json!(old)).unwrap();
        assert_eq!(
            serde_json::to_value(&history).unwrap(),
            serde_json::json!(old)
        );
        history.append("!");
        assert_eq!(
            serde_json::to_value(&history).unwrap(),
            serde_json::json!(expected(old + "!"))
        );
    }
}
