//! A tiny ZIP writer, written by hand instead of pulling a crate.
//!
//! It only supports the STORE method (no compression). That is all a .docx
//! needs: Word, LibreOffice and Pages all open uncompressed packages, and
//! our XML parts are a few kilobytes anyway.
//!
//! Format reference: PKWARE APPNOTE.TXT, sections 4.3.7 (local file header),
//! 4.3.12 (central directory header) and 4.3.16 (end of central directory).

/// CRC-32 (IEEE 802.3, reflected, polynomial 0xEDB88320) lookup table,
/// computed at compile time.
const CRC_TABLE: [u32; 256] = {
    let mut table = [0u32; 256];
    let mut i = 0;
    while i < 256 {
        let mut c = i as u32;
        let mut k = 0;
        while k < 8 {
            c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
            k += 1;
        }
        table[i] = c;
        i += 1;
    }
    table
};

pub fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &b in data {
        crc = CRC_TABLE[((crc ^ b as u32) & 0xFF) as usize] ^ (crc >> 8);
    }
    crc ^ 0xFFFF_FFFF
}

// MS-DOS timestamp for 1980-01-01 00:00. A fixed date keeps exports
// reproducible and avoids leaking the local clock into the file.
const DOS_TIME: u16 = 0;
const DOS_DATE: u16 = (1 << 5) | 1;
// Bit 11: file names are UTF-8.
const FLAG_UTF8: u16 = 1 << 11;

fn put_u16(out: &mut Vec<u8>, v: u16) {
    out.extend_from_slice(&v.to_le_bytes());
}
fn put_u32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes());
}

/// Builds a ZIP archive in memory from (name, bytes) entries, in order.
pub fn build(entries: &[(&str, &[u8])]) -> Result<Vec<u8>, String> {
    if entries.len() > u16::MAX as usize {
        return Err("too many zip entries".into());
    }
    let mut out = Vec::new();
    let mut central = Vec::new();

    for (name, data) in entries {
        let name = name.as_bytes();
        let size = u32::try_from(data.len()).map_err(|_| "zip entry too large")?;
        let name_len = u16::try_from(name.len()).map_err(|_| "zip entry name too long")?;
        let offset = u32::try_from(out.len()).map_err(|_| "zip archive too large")?;
        let crc = crc32(data);

        // Local file header
        put_u32(&mut out, 0x0403_4b50);
        put_u16(&mut out, 20); // version needed to extract (2.0)
        put_u16(&mut out, FLAG_UTF8);
        put_u16(&mut out, 0); // method: stored
        put_u16(&mut out, DOS_TIME);
        put_u16(&mut out, DOS_DATE);
        put_u32(&mut out, crc);
        put_u32(&mut out, size); // compressed size
        put_u32(&mut out, size); // uncompressed size
        put_u16(&mut out, name_len);
        put_u16(&mut out, 0); // extra field length
        out.extend_from_slice(name);
        out.extend_from_slice(data);

        // Central directory header
        put_u32(&mut central, 0x0201_4b50);
        put_u16(&mut central, 20); // version made by
        put_u16(&mut central, 20); // version needed
        put_u16(&mut central, FLAG_UTF8);
        put_u16(&mut central, 0);
        put_u16(&mut central, DOS_TIME);
        put_u16(&mut central, DOS_DATE);
        put_u32(&mut central, crc);
        put_u32(&mut central, size);
        put_u32(&mut central, size);
        put_u16(&mut central, name_len);
        put_u16(&mut central, 0); // extra
        put_u16(&mut central, 0); // comment
        put_u16(&mut central, 0); // disk number start
        put_u16(&mut central, 0); // internal attributes
        put_u32(&mut central, 0); // external attributes
        put_u32(&mut central, offset);
        central.extend_from_slice(name);
    }

    let cd_offset = u32::try_from(out.len()).map_err(|_| "zip archive too large")?;
    let cd_size = u32::try_from(central.len()).map_err(|_| "zip archive too large")?;
    out.extend_from_slice(&central);

    // End of central directory record
    let count = entries.len() as u16;
    put_u32(&mut out, 0x0605_4b50);
    put_u16(&mut out, 0); // this disk
    put_u16(&mut out, 0); // disk with central directory
    put_u16(&mut out, count);
    put_u16(&mut out, count);
    put_u32(&mut out, cd_size);
    put_u32(&mut out, cd_offset);
    put_u16(&mut out, 0); // comment length
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc_matches_known_vector() {
        // Standard check value for "123456789".
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    }

    #[test]
    fn builds_valid_structure() {
        let zip = build(&[("a.txt", b"hello"), ("dir/b.txt", b"")]).unwrap();
        assert_eq!(&zip[0..4], &[0x50, 0x4b, 0x03, 0x04]);
        let eocd = &zip[zip.len() - 22..];
        assert_eq!(&eocd[0..4], &[0x50, 0x4b, 0x05, 0x06]);
        assert_eq!(u16::from_le_bytes([eocd[10], eocd[11]]), 2);
    }
}
