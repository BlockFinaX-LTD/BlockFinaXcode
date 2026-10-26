import { ReactNode } from 'react';
import { Link } from 'wouter';
import { H1, Lead, LessonTag } from '../lesson-blocks';

/** A link to another page of the documentation. */
export function A({ to, children }: { to: string; children: ReactNode }) {
  return <Link href={to ? `/learn/${to}` : '/learn'} className="ac-link">{children}</Link>;
}

export function Head({ part, title, children }: { part: string; title: string; children: ReactNode }) {
  return (
    <>
      <LessonTag>{part}</LessonTag>
      <H1>{title}</H1>
      <Lead>{children}</Lead>
    </>
  );
}

/** The hypothetical contract used across the documentation. */
export const EX = {
  pair: 'USD/GHS',
  convention: 'Rates are quoted in cedis per one US dollar, so a higher number means a weaker cedi.',
};
