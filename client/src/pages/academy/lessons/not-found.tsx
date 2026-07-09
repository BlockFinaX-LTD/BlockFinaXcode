import { Link } from 'wouter';
import { H1, Lead, LessonTag, P } from '../lesson-blocks';

export default function AcademyNotFound() {
  return (
    <>
      <LessonTag>404 · No such lesson</LessonTag>
      <H1>That lesson isn&apos;t in the syllabus yet</H1>
      <Lead>
        The URL didn&apos;t match any lesson in the catalog. It may have
        been renamed. Start from the top or pick something else from
        the sidebar.
      </Lead>
      <P><Link href="/learn">Return to the course index.</Link></P>
    </>
  );
}
