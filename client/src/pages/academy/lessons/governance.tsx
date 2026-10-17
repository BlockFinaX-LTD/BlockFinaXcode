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

      <Section n="02" id="custody" title="Fund custody and verification limits">
        <P>
          Source-level descriptions do not prove which custody and accounting
          paths are active in a deployed Diamond. The active selector mapping,
          current bytecode, token balances, accounting state and transaction
          history all need to be checked together.
        </P>
        <Callout kind="warn" label="No custody guarantee">
          Do not assume only platform fees can leave the Diamond, or that a
          Safe owner relationship prevents asset loss. Verify every active
          transfer path and upgrade path against deployed bytecode and test the
          relevant accounting invariants independently.
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
            The Diamond upgrade selector. The current implementation and
            owner are read live in the Data Room; this lesson does not
            assume that the selector is immediate or timelocked.
          </KVRow>
          <KVRow term="TimelockCutFacet">
            A possible hardened variant. Whether it is deployed and
            actually routes the upgrade selector must be verified from
            current chain state and implementation code. A contract name
            or deployment record alone does not establish an enforced delay.
          </KVRow>
        </KV>
        <P>
          An enforced timelock can provide an observation window, but its
          presence and guarantees depend on the live selector routing and
          implementation. Verify those before relying on a delay.
        </P>
        <Callout kind="warn" label="Where we are today">
          Check the Data Room&apos;s live governance read for the current
          Diamond owner, whether the configured Safe controls it, and the
          active upgrade-selector implementation. If a chain read is
          unavailable, its governance status is unverified. A Safe that
          exists or has signed a transaction is not necessarily the Diamond
          owner, and the page does not infer a timelock from a facet name.
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
          If an owner with immediate authority is compromised, it could
          roster a malicious signer set. Whether a timelock protects such
          changes depends on the active implementation and selector
          routing; verify this on chain.
        </P>
      </Section>

      <Section n="05" id="trust" title="What still requires trust">
        <P>Being blunt about the trust surface today.</P>
        <OL>
          <li>
            <strong>The active upgrade authority</strong> may be able to
            replace protocol code. Check the live owner and upgrade path
            before relying on assumptions about who can do so.
          </li>
          <li>
            <strong>Settlement authority</strong> depends on the live
            oracle mode and consensus settings shown in the Data Room.
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
