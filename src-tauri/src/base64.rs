//! Standard base64 decoding (RFC 4648, with padding), written by hand
//! instead of pulling a crate. Images arrive from the webview as base64,
//! which is how the browser hands them out (data: URLs).

fn value(c: u8) -> Option<u32> {
    match c {
        b'A'..=b'Z' => Some((c - b'A') as u32),
        b'a'..=b'z' => Some((c - b'a' + 26) as u32),
        b'0'..=b'9' => Some((c - b'0' + 52) as u32),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

/// Decodes padded base64. Returns None for anything malformed.
pub fn decode(text: &str) -> Option<Vec<u8>> {
    let s = text.as_bytes();
    if s.len() % 4 != 0 {
        return None;
    }
    let groups = s.len() / 4;
    let mut out = Vec::with_capacity(groups * 3);
    for (i, chunk) in s.chunks_exact(4).enumerate() {
        let pad = chunk.iter().rev().take_while(|&&c| c == b'=').count();
        // Padding only at the very end, and at most two characters of it.
        if pad > 2 || (pad > 0 && i + 1 != groups) {
            return None;
        }
        let mut n = 0u32;
        for &c in &chunk[..4 - pad] {
            n = (n << 6) | value(c)?;
        }
        n <<= 6 * pad as u32;
        out.extend_from_slice(&[(n >> 16) as u8, (n >> 8) as u8, n as u8][..3 - pad]);
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::decode;

    #[test]
    fn decodes_rfc_4648_vectors() {
        for (enc, dec) in [("", ""), ("Zg==", "f"), ("Zm8=", "fo"), ("Zm9v", "foo"), ("Zm9vYg==", "foob"), ("Zm9vYmE=", "fooba"), ("Zm9vYmFy", "foobar")] {
            assert_eq!(decode(enc).as_deref(), Some(dec.as_bytes()), "{enc}");
        }
        assert_eq!(decode("/+8=").unwrap(), vec![0xff, 0xef]);
    }

    #[test]
    fn rejects_malformed_input() {
        for bad in ["Zg=", "Zg=a", "Z===", "Zg==Zm9v", "Zm9-", "Zm 9"] {
            assert!(decode(bad).is_none(), "{bad}");
        }
    }
}
