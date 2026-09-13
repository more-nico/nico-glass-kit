import type { ReactNode } from 'react';
import { GlassSurface } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { glassProps } from './demoProps';

interface Props {
  /** Two-digit gallery index rendered as a chip inside the header. */
  index: string;
  title: ReactNode;
  description: ReactNode;
  params: DemoParams;
  children: ReactNode;
}

/**
 * Gallery section whose header is itself a glass bar, so the page chrome shares
 * the material of the components it presents. `children` is the section body
 * (normally a `.demo-body` wrapper); the body is left untouched so each demo
 * keeps its own layout.
 */
export function DemoSection({ index, title, description, params, children }: Props) {
  return (
    <section className="demo-section">
      <GlassSurface className="demo-head" cornerRadius={22} {...glassProps(params)}>
        <span className="demo-index" aria-hidden="true">
          {index}
        </span>
        <div className="demo-head-text">
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </GlassSurface>
      {children}
    </section>
  );
}
