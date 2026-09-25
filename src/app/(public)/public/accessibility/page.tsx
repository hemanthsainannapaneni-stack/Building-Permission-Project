import type { Metadata } from 'next';
import { PageFrame, Panel } from '@/features/public-portal/primitives';

export const metadata: Metadata = { title: 'Accessibility' };

export default function AccessibilityPage() {
  return (
    <PageFrame title="Accessibility" intro="How to change text size and contrast, move around by keyboard, and use a screen reader with the portal." crumbs={[]}>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Text size and contrast">
          <ul className="list-disc space-y-2 pl-5 text-body text-text-muted">
            <li><strong className="text-text">A+</strong> makes text larger, up to 125%. <strong className="text-text">A</strong> returns to normal. <strong className="text-text">A-</strong> makes text smaller.</li>
            <li><strong className="text-text">Contrast</strong> switches to a high-contrast scheme with darker text and underlined links.</li>
            <li>Your choice is remembered on this device and applies only to the public portal.</li>
          </ul>
        </Panel>
        <Panel title="Keyboard">
          <ul className="list-disc space-y-2 pl-5 text-body text-text-muted">
            <li><strong className="text-text">Skip to Main Content</strong> is the first link on every page.</li>
            <li>Tab and Shift+Tab move between links and controls, and the focused item is outlined.</li>
            <li>On a small screen the Menu button opens the navigation; Escape closes it.</li>
          </ul>
        </Panel>
        <Panel id="screen-reader" title="Screen Reader Access" className="lg:col-span-2 scroll-mt-4">
          <div className="space-y-3 text-body text-text-muted">
            <p>The portal is built with semantic landmarks (banner, navigation, main, footer), one main heading per page and headings in order, so a screen reader can list and jump between them.</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Every form field has a visible label, and errors are announced when they appear.</li>
              <li>Decorative pictures are hidden from assistive technology; meaningful ones have a text description.</li>
              <li>Results and confirmations are announced as they appear.</li>
              <li>Tables have captions and column headers.</li>
            </ul>
            <p>This has been built to good practice but has not been audited against a formal standard. If something does not work for you, tell the Helpdesk.</p>
          </div>
        </Panel>
      </div>
    </PageFrame>
  );
}
