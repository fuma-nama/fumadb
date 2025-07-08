import { CodeBlock } from "@/components/codeblock";
import Link from "next/link";

const features = [
  {
    title: "Unified Querying Interface",
    description:
      "Prisma-like API for library authors to query databases, with support for relations.",
  },
  {
    title: "Unified Schema Definition",
    description:
      "Design schemas without worrying about the underlying ORM or database consumer.",
  },
  {
    title: "Built-in SQL Migrator",
    description:
      "Automatic migrations for users without an existing pipeline, built on Kysely.",
  },
  {
    title: "ORM & Database Agnostic",
    description:
      "Integrates with multiple ORMs and databases, handling inconsistencies for you.",
  },
];

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center gap-16">
      {/* Hero Section */}
      <section className="max-w-2xl mx-auto">
        <h1 className="mb-4 text-4xl font-extrabold tracking-tight lg:text-5xl">
          FumaDB
        </h1>
        <p className="mb-6 text-base text-fd-muted-foreground md:text-lg">
          A library for libraries to interact with databases.
          <br />
          <span className="text-sm text-fd-foreground/70 md:text-base">
            Unify your database access, schema, and migrations—no matter the ORM
            or database.
          </span>
        </p>
        <div className="flex justify-center gap-3">
          <Link
            href="/docs"
            className="px-6 py-2 rounded-lg bg-fd-primary text-fd-primary-foreground font-medium hover:bg-fd-primary/90 transition"
          >
            Get Started
          </Link>
          <a
            href="https://github.com/fuma-nama/fumadb"
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-2 rounded-lg border text-fd-secondary-foreground bg-fd-secondary font-medium hover:bg-fd-accent transition-colors"
          >
            GitHub
          </a>
        </div>
      </section>

      <section className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-3">
        {features.map((feature) => (
          <div
            key={feature.title}
            className="rounded-lg border bg-fd-card text-fd-card-foreground inset-shadow-sm inset-shadow-fd-accent p-6 text-start"
          >
            <h3 className="text-lg font-bold mb-2">{feature.title}</h3>
            <p className="text-fd-muted-foreground">{feature.description}</p>
          </div>
        ))}
      </section>

      <CodeBlock
        lang="ts"
        className="my-0 text-left"
        title="Quick Start Example"
        code={`import { column, idColumn, schema, table } from "fumadb/schema";

const users = table("users", {
  id: idColumn("id", "varchar(255)", { default: "auto" }),
  name: column("name", "string"),
});

export const v1 = schema({
  version: "1.0.0",
  tables: { users },
});
`}
      />

      <p className="mt-8 text-xs text-fd-muted-foreground">
        🚧 FumaDB is a work in progress.
      </p>
    </main>
  );
}
