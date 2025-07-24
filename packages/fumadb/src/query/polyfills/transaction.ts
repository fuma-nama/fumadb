import { AbstractQuery, AbstractTable, TransactionAbstractQuery } from "..";
import { AnySchema } from "../../schema";

enum ActionType {
  Insert,
  Update,
  Delete,
  Sub,
}

type Action =
  | {
      type: ActionType.Delete;
      id: unknown;
      table: AbstractTable;
      values: Record<string, unknown>;
    }
  | {
      type: ActionType.Insert;
      table: AbstractTable;
      id: unknown;
    }
  | {
      type: ActionType.Update;
      id: unknown;
      table: AbstractTable;
      updatedFields: string[];
      beforeUpdate: Record<string, unknown>;
    }
  | {
      type: ActionType.Sub;
      ctx: TransactionAbstractQuery<AnySchema>;
    };

/**
 * Soft transaction support, doesn't support OCC.
 *
 * It works by reverting your operations when rollback, and during the process concurrent requests may conflict, hence it can be dangerous.
 *
 */
export function createTransaction<S extends AnySchema>(
  orm: AbstractQuery<S>
): TransactionAbstractQuery<S> {
  const stack: Action[] = [];

  return {
    internal: orm.internal,
    count: orm.count,
    findFirst: orm.findFirst,
    findMany: orm.findMany,
    async rollback() {
      while (stack.length > 0) {
        const entry = stack.pop()!;
        if (entry.type === ActionType.Sub) {
          await entry.ctx.rollback?.();
          continue;
        }

        const table = entry.table;
        const idField = table._.raw.getIdColumn().ormName;

        switch (entry.type) {
          case ActionType.Insert:
            await orm.deleteMany(table, {
              where: (b) => b(table[idField]!, "in", entry.id),
            });
            break;
          case ActionType.Update: {
            const set: Record<string, unknown> = {};
            for (const key of entry.updatedFields) {
              set[key] = entry.beforeUpdate[key];
            }
            await orm.updateMany(table, {
              where: (b) => b(table[idField]!, "=", entry.id),
              set,
            });
            break;
          }
          case ActionType.Delete:
            await orm.createMany(table, [entry.values]);
            break;
        }
      }
    },
    async create(table, values) {
      const result = await orm.create(table, values);
      const idField = table._.raw.getIdColumn().ormName;

      stack.push({ type: ActionType.Insert, id: result[idField], table });

      return result;
    },
    async createMany(table, values) {
      const result = await orm.createMany(table, values);

      for (const value of result) {
        stack.push({
          type: ActionType.Insert,
          table,
          id: value._id,
        });
      }

      return result;
    },
    async deleteMany(table, v) {
      const targets = await orm.findMany(table, {
        where: v.where,
      });

      const idField = table._.raw.getIdColumn().ormName;

      await orm.deleteMany(table, {
        where: (b) =>
          b(
            table[idField]!,
            "in",
            targets.map((target) => target[idField])
          ),
      });

      for (const target of targets) {
        stack.push({
          type: ActionType.Delete,
          id: target[idField],
          values: target,
          table,
        });
      }
    },
    async updateMany(table, v) {
      const idField = table._.raw.getIdColumn().ormName;
      const targets = await orm.findMany(table, {
        where: v.where,
      });

      await orm.updateMany(table, {
        set: v.set,
        where: (b) =>
          b(
            table[idField]!,
            "in",
            targets.map((target) => target[idField])
          ),
      });

      const updatedFields = Object.keys(v.set);
      for (const target of targets) {
        stack.push({
          type: ActionType.Update,
          id: target[idField],
          beforeUpdate: target,
          table,
          updatedFields,
        });
      }
    },
    async upsert(table, v) {
      const target = await orm.findFirst(table, {
        where: v.where,
      });

      if (!target) {
        await this.createMany(table, [v.create]);
      } else {
        const idField = table._.raw.getIdColumn().ormName;

        await this.updateMany(table, {
          where: (b) => b(table[idField]!, "=", target[idField]),
          set: v.update,
        });
      }
    },
    transaction(run) {
      return orm.transaction(async (ctx) => {
        const result = await run(ctx);
        stack.push({
          type: ActionType.Sub,
          ctx,
        });

        return result;
      });
    },
    tables: orm.tables,
  };
}
