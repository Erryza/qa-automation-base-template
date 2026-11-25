# Scope detection — API vs UI vs both

The skill does **not** assume a fixed scope. It reads the inputs and decides which kinds of test cases to author. A project with no front-end yields API-only test cases naturally — because no UI signal is present — not because of a hardcoded rule.

---

## Signals → scope

| Signal in the inputs | Author these test cases |
|----------------------|-------------------------|
| API spec (OpenAPI/Swagger/Postman), or API/endpoint/request-response sections in the TSD | **API** test cases |
| FSD screen designs, wireframes, field/validation tables, page flows | **UI/FE** test cases |
| A Figma MCP connection or a shared Figma link | **UI/FE** test cases (derive from designs) |
| Both API sections **and** screen designs | **Both** (one feature tab per API group + one per screen/module) |

When in doubt, prefer **including** a scope you have evidence for over guessing — but never invent endpoints or screens that the inputs don't describe.

---

## API scope — what to cover

When API signal is present, each endpoint/feature tab should cover:

1. Request/response **I/O** matches the spec (fields, status codes, response codes).
2. **Mandatory / Optional / Conditional** body fields.
3. Request **headers** + **body**: invalid + empty per mandatory header; invalid + empty per mandatory body field.
4. Response **headers** + **body** in Expected Results (`1. Status / 2. Header / 3. Body`).
5. **Timeouts** and error codes from the spec error table (one TC per response code the spec defines).
6. **Anomalies**: invalid data, duplicate transaction, format errors, wrong HTTP method.
7. **Auth & signature** failures — values must match the spec's algorithm/shape (see [tsd-alignment.md](tsd-alignment.md)).
8. **Boundaries** where the spec states a max length (value = max+1).
9. **Business / conditional rules** the spec defines, exercised through the API.

`Platform` column = `API` (or `Service`) on these rows. The validator applies API-specific checks (bold negative Test Data, `Header:`/`Body:` sections, signature shape) only to these rows.

---

## UI/FE scope — what to cover

When screen designs or a Figma reference are present, each screen/module tab should cover:

1. **Valid path** Positive per flow (the screen does what the design says).
2. **Field-level validation**: each required field empty; invalid format; max/min length; allowed character sets.
3. **Validation messages** copied verbatim from the FSD/Figma (inline errors, toasts, banners).
4. **Navigation**: correct routing on submit/cancel/back; deep links; guard/redirect rules.
5. **States**: loading, empty, error, success, disabled/enabled controls, conditional visibility.
6. **Negative interactions**: blocked submit, double-submit, unauthorized access.

`Platform` column = `Web`, `UI`, or `Mobile`. For UI rows, Test Data is field values (no `Header:`/`Body:` requirement), Test Steps are user actions, Expected Results are observable outcomes — the validator does **not** require API-shaped content on these rows.

When a Figma MCP is connected, pull component/state lists from the design; otherwise read the FSD screen-design section. Either way, **derive** test cases — do not require Figma.

---

## Strict scope (opt-in)

Some engagements ban out-of-scope rows entirely (e.g. an API-only project that forbids DB/network/query-reconcile sheets). That is a **project decision**, recorded in a project overlay, not a core rule. When such a profile applies:

- Run the validator with `--strict-scope` (or `--profile api-only`).
- The forbidden-scope list lives in the project overlay (see [project-playbooks/README.md](../project-playbooks/README.md)).

By default the validator enforces **no** scope restriction, so generic FE/UI/full-stack workbooks pass.
