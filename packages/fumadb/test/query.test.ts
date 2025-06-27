import { expect, test } from "vitest";
import { buildWhere } from "../src/query/orm/kysely";
import { expressionBuilder } from "kysely";
import {
  AbstractColumn,
  AbstractTableInfo,
  eb as b,
  Condition,
} from "../src/query";
import { table } from "../src/schema";
test("build conditions", async () => {
  const eb = expressionBuilder<any, any>();
  const users = table("users", {
    test: {
      type: "date",
      name: "test",
    },
    name: {
      type: "string",
      name: "name",
    },
    time: {
      type: "timestamp",
      name: "date",
    },
  });

  const info = new AbstractTableInfo("users", users);
  const name = new AbstractColumn<string>("name", info, users.columns.name);
  const test = new AbstractColumn<string>("test", info, users.columns.test);
  const time = new AbstractColumn<Date>("time", info, users.columns.test);

  expect(buildWhere(b(test, "=", "value"), eb).toOperationNode())
    .toMatchInlineSnapshot(`
      {
        "kind": "BinaryOperationNode",
        "leftOperand": {
          "column": {
            "column": {
              "kind": "IdentifierNode",
              "name": "test",
            },
            "kind": "ColumnNode",
          },
          "kind": "ReferenceNode",
          "table": {
            "kind": "TableNode",
            "table": {
              "identifier": {
                "kind": "IdentifierNode",
                "name": "users",
              },
              "kind": "SchemableIdentifierNode",
            },
          },
        },
        "operator": {
          "kind": "OperatorNode",
          "operator": "=",
        },
        "rightOperand": {
          "kind": "ValueNode",
          "value": "value",
        },
      }
    `);

  expect(
    buildWhere(
      b.or(
        b.and(b.isNotNull(test), b(test, ">", name)),
        b(time, "<=", new Date(0))
      ) as Condition,
      eb
    ).toOperationNode()
  ).toMatchInlineSnapshot(`
    {
      "kind": "ParensNode",
      "node": {
        "kind": "OrNode",
        "left": {
          "kind": "ParensNode",
          "node": {
            "kind": "AndNode",
            "left": {
              "kind": "BinaryOperationNode",
              "leftOperand": {
                "column": {
                  "column": {
                    "kind": "IdentifierNode",
                    "name": "test",
                  },
                  "kind": "ColumnNode",
                },
                "kind": "ReferenceNode",
                "table": {
                  "kind": "TableNode",
                  "table": {
                    "identifier": {
                      "kind": "IdentifierNode",
                      "name": "users",
                    },
                    "kind": "SchemableIdentifierNode",
                  },
                },
              },
              "operator": {
                "kind": "OperatorNode",
                "operator": "is not",
              },
              "rightOperand": {
                "immediate": true,
                "kind": "ValueNode",
                "value": null,
              },
            },
            "right": {
              "kind": "BinaryOperationNode",
              "leftOperand": {
                "column": {
                  "column": {
                    "kind": "IdentifierNode",
                    "name": "test",
                  },
                  "kind": "ColumnNode",
                },
                "kind": "ReferenceNode",
                "table": {
                  "kind": "TableNode",
                  "table": {
                    "identifier": {
                      "kind": "IdentifierNode",
                      "name": "users",
                    },
                    "kind": "SchemableIdentifierNode",
                  },
                },
              },
              "operator": {
                "kind": "OperatorNode",
                "operator": ">",
              },
              "rightOperand": {
                "column": {
                  "column": {
                    "kind": "IdentifierNode",
                    "name": "name",
                  },
                  "kind": "ColumnNode",
                },
                "kind": "ReferenceNode",
                "table": {
                  "kind": "TableNode",
                  "table": {
                    "identifier": {
                      "kind": "IdentifierNode",
                      "name": "users",
                    },
                    "kind": "SchemableIdentifierNode",
                  },
                },
              },
            },
          },
        },
        "right": {
          "kind": "BinaryOperationNode",
          "leftOperand": {
            "column": {
              "column": {
                "kind": "IdentifierNode",
                "name": "test",
              },
              "kind": "ColumnNode",
            },
            "kind": "ReferenceNode",
            "table": {
              "kind": "TableNode",
              "table": {
                "identifier": {
                  "kind": "IdentifierNode",
                  "name": "users",
                },
                "kind": "SchemableIdentifierNode",
              },
            },
          },
          "operator": {
            "kind": "OperatorNode",
            "operator": "<=",
          },
          "rightOperand": {
            "kind": "ValueNode",
            "value": 1970-01-01T00:00:00.000Z,
          },
        },
      },
    }
  `);
});
