# Testnet implementation evidence

Verified on October 9, 2026 with Chromium's virtual P-256 authenticator and real Stellar testnet RPC. These are test accounts; no customer funds were used.

- First smart account: `CBCNOTKHSNXQA3SRLZVOAA6PY75J4JPHBJ4QQEUSATZLBPEGTE4FOG53`
- Second smart account: `CDC52GE4WCWFXFR4RKLI5MPQE4BCBENK2NJEOK7E2IOB6EKXXUYVKVPX`
- First deployment: [2b5fe26d…](https://stellar.expert/explorer/testnet/tx/2b5fe26d38538aabcbb0cc69458e6972c41c8b0280b232bb34a5aa61b8f795ba)
- Second deployment: [37545016…](https://stellar.expert/explorer/testnet/tx/375450161e6fe26976bc42c82f2c8a3dfc4acac09dff9d92b9b1e004e6ef0bab)
- 100 test XLM funding: [17dc0311…](https://stellar.expert/explorer/testnet/tx/17dc0311743dc006397baad32df90754841a21cb33544649b61e3a43322c0249)
- Passkey-approved 5 test XLM payment: [b72e7fb4…](https://stellar.expert/explorer/testnet/tx/b72e7fb499a709f3cbaf6621ed47c89b3d64986cad8a13a8f6943023b38188e0)

The browser test confirmed the recipient's balance and reconnected the sender to the same smart account after reload. It also checked that a second faucet request within 24 hours was refused. The test is reproducible with `npm run test:e2e` after setup and build. A testnet reset can remove these historical accounts and transactions.

Eight offline tests cover session integrity, single-use challenges/codes, code expiry and attempt limits, Resend failure handling, unique wallet ownership and sponsorship restrictions. The browser flow also passes with email-code sign-in. Resend accepted a verification-code email to its automated delivery test address using the configured BlockFinaX sender. Google is not represented as live-provider tested.
