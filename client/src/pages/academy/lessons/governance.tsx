import { Callout, CodeInline, H1, KV, KVRow, Lead, LessonTag, OL, P, Section, UL } from '../lesson-blocks';

export default function Governance() {
  return (
    <>
      <LessonTag>Lesson 11 · Deep dives</LessonTag>
      <H1>Governance and security</H1>
      <Lead>
        Every protocol has a governance surface. This lesson maps ours
        honestly. What can change, who can change it, on what timeline,
        and where trust still has to be extended today with the
        intention of reducing that surface tomorrow.
      </Lead>

      <Section n="01" id="diamond" title="Why a Diamond">
        <P>
          BlockFinaX is an EIP-2535 Diamond. That word chooses a
          specific upgrade pattern out of several options in Ethereum.
          It&apos;s worth understanding why.
        </P>
        <KV>
          <KVRow term="One proxy address, forever">
            The Diamond&apos;s address is what every user, integrator, and
            explorer knows the protocol by. It never changes across
            upgrades. Bookmarks, allowances, event history: all stable.
          </KVRow>
          <KVRow term="Facets do the work">
            Each area of the protocol (hedge lifecycle, oracle,
            upgrades, introspection) lives in its own facet contract.
            The Diamond routes function calls to the right facet by
            selector.
          </KVRow>
          <KVRow term="Storage in isolated slots">
            Facets don&apos;t share Solidity storage layouts. They read and
            write through three AppStorage slots that live at hashed
            offsets. Fields are only ever appended. Never reordered.
          </KVRow>
        </KV>
        <P>
          The result is a codebase where you can ship a new facet
          without redeploying the protocol, and users don&apos;t have to
          migrate. The cost is that upgrade authority is real. Who
          holds it, and on what timeline, is the rest of this lesson.
        </P>
      </Section>

      <Section n="02" id="custody" title="Fund custody guarantees">
        <P>
          Before we talk about who can upgrade what, be precise about
          how funds are held.
        </P>
        <UL>
          <li>
            All user funds (LP capital, hedger premiums, reserved
            payouts, platform fees) pool inside the Diamond. There is
            no external treasury contract, no yield-vault sidecar, no
            third-party custodian.
          </li>
          <li>
            The contract tracks token balances by internal counter
            (<CodeInline>tokenReserves</CodeInline>, per-token fee
            counters, per-deposit shares) rather than by
            <CodeInline>balanceOf</CodeInline>. Donation attacks and
            rounding griefs can&apos;t shift accounting.
          </li>
          <li>
            A shared reentrancy guard is applied across facets. External
            token transfers happen last in every function that touches
            state. Strict Check-Effects-Interactions.
          </li>
          <li>
            The owner-only fee withdrawal path is upper-bounded by the
            fee counter. It reverts if the owner tries to withdraw
            more than the accrued fees.
          </li>
          <li>
            <CodeInline>rescueERC20</CodeInline> exists for stray non-
            payment tokens accidentally sent to the diamond. It
            explicitly refuses to touch a whitelisted payment token.
          </li>
        </UL>
        <Callout label="Application-layer guarantee">
          At the code that&apos;s currently live, the owner cannot pull LP
          capital, premiums, or reserved payouts through any normal
          function. Fee withdrawal is the only value-out path, and
          it&apos;s bounded.
        </Callout>
      </Section>

      <Section n="03" id="timelock" title="The timelock story">
        <P>
          Diamonds can upgrade. That&apos;s the point. The question is on
          what delay, and whose signature is required.
        </P>
        <P>BlockFinaX ships two upgrade entrypoints.</P>
        <KV>
          <KVRow term="DiamondCutFacet">
            The classic path. <CodeInline>diamondCut(cuts, init, data)</CodeInline> applies
            immediately. Owner-only. Currently active on both mainnet
            Diamonds.
          </KVRow>
          <KVRow term="TimelockCutFacet">
            A hardened variant. The same call schedules a proposal that
            can only be executed after a 48-hour delay and expires 30
            days in if unexecuted. An emergency cancel path exists.
            Not yet installed.
          </KVRow>
        </KV>
        <P>
          Wiring the timelock is the top of the security backlog. It&apos;s
          the single change that most changes the trust profile of the
          protocol. Every upgrade would become visible for 48 hours
          before it applied, and a malicious upgrade would be publicly
          watchable and cancellable.
        </P>
        <Callout kind="warn" label="Where we are today">
          Both mainnet Diamonds are owned by a single deployer EOA. The
          timelock facet is deployed but not installed. The Gnosis Safes
          are deployed but ownership hasn&apos;t been transferred to them.
          The path to hardening is documented and scripted. It hasn&apos;t
          been executed yet. If you&apos;re evaluating whether to underwrite
          a large position, this is the material fact.
        </Callout>
      </Section>

      <Section n="04" id="oracle-gov" title="Oracle governance">
        <P>Separate from Diamond ownership, the oracle facet has its own governance surface.</P>
        <UL>
          <li>
            <CodeInline>addOracle</CodeInline> and
            <CodeInline>removeOracle</CodeInline>. Up to ten registered
            signers.
          </li>
          <li>
            <CodeInline>setRequiredSigners(n)</CodeInline>. At least 2.
          </li>
          <li>
            <CodeInline>setToleranceBps(bps)</CodeInline>. Capped at 10%.
          </li>
          <li>
            <CodeInline>activateOracleV2()</CodeInline>. One-way switch
            that permanently disables the single-key
            <CodeInline>settleEvent</CodeInline> path.
          </li>
        </UL>
        <P>
          Oracle roster changes take effect immediately. Under the
          current governance posture, a compromised owner key could
          roster a malicious signer set and settle events at a
          fabricated rate. The same timelock work above closes that
          door. A rostered signer change would be watchable for 48
          hours.
        </P>
      </Section>

      <Section n="05" id="trust" title="What still requires trust">
        <P>Being blunt about the trust surface today.</P>
        <OL>
          <li>
            <strong>The deployer key</strong> can upgrade the protocol
            to arbitrary code. Nothing on-chain prevents that today.
          </li>
          <li>
            <strong>The oracle admin</strong> can, under the current
            single-key path, settle an event at a chosen rate without
            consensus.
          </li>
          <li>
            <strong>The pricing engine</strong> is off-chain. Its
            signer can be rotated by governance, and the contract falls
            back to an advisory mode if the signer is zeroed. But the
            quote path depends on it.
          </li>
        </OL>
        <P>
          The path to reducing every one of those is public. Install
          the timelock. Transfer ownership to the Safe. Activate oracle
          v2. What matters is that the same document you&apos;re reading
          names them rather than hiding them.
        </P>
      </Section>
    </>
  );
}
