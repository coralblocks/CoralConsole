import Link from "next/link";
import packageMetadata from "@/package.json";
import { ACTOR_META } from "./actor-ui";

const BrandIcon = ACTOR_META.sequencer.icon;

type ConsoleBrandProps = {
  ariaLabel: string;
  href?: string;
  subtitle: string;
};

function BrandContents({ subtitle }: Pick<ConsoleBrandProps, "subtitle">) {
  return (
    <>
      <span className="brand-mark" aria-hidden="true"><BrandIcon /></span>
      <span>
        <strong>CoralConsole <span className="brand-version">v{packageMetadata.version}</span></strong>
        <small>{subtitle}</small>
      </span>
    </>
  );
}

export function ConsoleBrand({ ariaLabel, href, subtitle }: ConsoleBrandProps) {
  if (href) {
    return (
      <Link className="brand" href={href} aria-label={ariaLabel}>
        <BrandContents subtitle={subtitle} />
      </Link>
    );
  }

  return (
    <div className="brand" aria-label={ariaLabel}>
      <BrandContents subtitle={subtitle} />
    </div>
  );
}

export function ConsoleFooter() {
  return (
    <footer className="console-footer">
      <p>
        <span className="brand-mark mini" aria-hidden="true"><BrandIcon /></span>
        CoralConsole v{packageMetadata.version}
      </p>
      <p>Shared topology · Persisted in SQLite</p>
    </footer>
  );
}
