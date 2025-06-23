import { expect, test } from "vitest";
import { buildWhere } from "../src/query/orm/kysely";
import { expressionBuilder } from "kysely";

test("build conditions", async () => {
  const eb = expressionBuilder<any, any>();
  const test = { name: "test" };

  expect(buildWhere([test, "=", "value"])(eb).toOperationNode())
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
        "table": undefined,
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
    buildWhere([
      [[test, "is not", null], "and", [test, ">", anotherCol]],
      "or",
      [test, "<=", new Date(0)],
    ])(eb).toOperationNode()
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
                "table": undefined,
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
                "table": undefined,
              },
              "operator": {
                "kind": "OperatorNode",
                "operator": ">",
              },
              "rightOperand": {
                "column": {
                  "column": {
                    "kind": "IdentifierNode",
                    "name": "value",
                  },
                  "kind": "ColumnNode",
                },
                "kind": "ReferenceNode",
                "table": undefined,
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
            "table": undefined,
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
