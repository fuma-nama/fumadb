import { expect, test } from "vitest";
import { buildWhere } from "../src/query/orm/kysely";
import { expressionBuilder } from "kysely";
import { AbstractColumn, AbstractTableInfo, eb as b } from "../src/query";
import { table } from "../src/schema";

test("build conditions", async () => {
  const eb = expressionBuilder<any, any>();
  const users = table("users", {
    test: {
      type: "string",
      name: "test",
    },
  });

  const test = new AbstractColumn(
    "test",
    new AbstractTableInfo("users", users),
    users.columns.test
  );

  expect(buildWhere(b(test, "=", "value"))(eb).toOperationNode())
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

  const anotherCol = { name: "value" };
  expect(
    buildWhere(
      b.or(
        b.and(b(test, "is not", null), b(test, ">", anotherCol)),
        b(test, "<=", new Date(0))
      ) as any
    )(eb).toOperationNode()
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
                "kind": "ValueNode",
                "value": {
                  "name": "value",
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
