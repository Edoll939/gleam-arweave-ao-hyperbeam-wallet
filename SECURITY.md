# Security Policy

Gleam is a browser-extension wallet holding user private keys. Please report
vulnerabilities privately rather than through a public GitHub issue.

How Gleam protects keys, what it defends against, its by-design
trade-offs and its known limitations are in
[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md). The files
in scope for a security review are listed in
[security/surface.txt](security/surface.txt).

## Reporting a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet/security/advisories/new)
for this repository (Security tab → Report a vulnerability). This opens a
private draft advisory visible only to maintainers until a fix ships.

Include:

- Steps to reproduce, and a failing test where you can write one.
- The answers to the three questions under Severity, and the function a
  fix has to change, as lines of their own:

  ```text
  Severity: high
  Attacker: Malicious website
  Loss: mismatch
  Requires: one-click
  Fix location: packages/core/src/ao/other-tags.ts#otherTags
  ```

If you have signed a [community scan](SCANS.md), include its
attestation id as a line of its own, `Attestation id: <64 hex characters>`,
so the finding is credited to the wallet that signed the scan. Any
attestation your wallet signed works, not only the one from the round
that found the issue.

## Severity

A maintainer sets the severity of each confirmed report by what was
shown under realistic conditions, not the worst case imaginable. Every
report answers three questions, and the answers set the severity.

1. **Attacker:** who does it. One row of
   [THREAT_MODEL.md § Attackers](docs/THREAT_MODEL.md#attackers), such as
   a malicious website or someone at an unlocked browser.
2. **Loss:** what the user loses. Pick one:
   - `key`: the private key or the vault password leaves the wallet.
   - `unapproved`: a signature or transfer the user never approved.
   - `mismatch`: the user approves one thing and signs another. The
     preview shows a different recipient, amount, asset or authority
     from the one signed, or leaves one out. A value shown correctly but
     easy to misread, such as a lookalike name or a truncated one whose
     full value is a click away, is `none`.
   - `control`: a control the user set stops holding, such as a revoked
     site, the auto-lock or a passkey removal.
   - `disclosure`: a site learns an address or other data without the
     user's consent.
   - `lockout`: the wallet can't sign or unlock until the user acts.
   - `none`: none of these.
3. **Requires:** what has to happen beyond ordinary use.
   - `none`: nothing.
   - `one-click`: one approval of a prompt that doesn't look wrong.
   - `unusual`: an action or setting few users have, or a condition the
     attacker doesn't control, such as a race or a browser restart. The
     shape of a request is not unusual: a malicious site sends any shape
     it likes.

| Loss | Requires none | one-click | unusual |
| --- | --- | --- | --- |
| `key`, `unapproved` | Critical | High | Medium |
| `mismatch`, `control` | High | High | Medium |
| `disclosure`, `lockout` | Medium | Medium | Low |
| `none` | Low | Low | Low |

Only Medium and above earns a share of the bounty pool
([SCANS.md § Points](SCANS.md#points)). A docs mismatch, missing
defence in depth, or disclosure of non-secret internals is `none`.

## Scope

In scope: the extension itself (`apps/extension`), the core signing/vault
logic (`packages/core`), and the messaging contracts between them
(`packages/messaging`). Third-party dependency vulnerabilities are tracked
via Dependabot; if you find one that isn't already flagged in the Security
tab, reporting it here is still welcome.

## Vault backup

The optional vault backup is one file in the user's own Google Drive app
folder, or iCloud on iOS. It is encrypted under a random key, and that key
is stored beside it wrapped under the vault password with Argon2id. Where
an install has a passkey, the file's header also carries the vault
password wrapped under that passkey's PRF output, so a restore can use the
passkey; only the authenticator can compute that key. Google and Apple
hold ciphertext they cannot read, Gleam runs no server and holds nothing,
and the password or a passkey that wraps it is the only key to the file.
Someone who takes over the account gets an offline guess at the password,
so a report that weakens the password policy, the key wrapping, the
passkey wrapping or the file's encryption is in scope.

## Response

We aim to acknowledge reports within a few days and to keep the reporter
updated as a fix is developed. Credit is given in the advisory unless you'd
rather stay anonymous.
