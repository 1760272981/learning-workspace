export function createDatabaseCore(options) {
  const uniqueKeys = {
    lw_users: [['id'], ['username']],
    lw_sessions: [['token_digest']],
    lw_auth_limiter: [['key']],
    lw_tokens: [['token_digest']],
    lw_concepts: [['id']],
    lw_applications: [['id'], ['concept_id', 'output_ref']],
    lw_verifications: [['id']],
    lw_marks: [['id'], ['project_id', 'concept_id']],
  }
  let queue = Promise.resolve()
  const enqueue = (run) => queue = queue.then(run, run)

  function builder(table, mode, values) {
    const filters = []
    let columns = '*'
    let orderBy = null
    let maxRows = Infinity
    let range = null
    let execution
    const run = async () => {
      const tables = await options.read()
      const list = tables.get(table) || []
      const matches = (row) => filters.every(([key, value]) => row[key] === value)
      if (mode === 'read') {
        let selected = list.filter(matches)
        if (orderBy) selected = [...selected].sort((a, b) => String(a[orderBy.column]).localeCompare(String(b[orderBy.column])) * (orderBy.ascending ? 1 : -1))
        if (range) selected = selected.slice(range.from, range.to + 1)
        else if (Number.isFinite(maxRows)) selected = selected.slice(0, maxRows)
        const pick = (row) => columns && columns !== '*'
          ? Object.fromEntries(columns.split(',').map((column) => [column.trim(), row[column.trim()]]))
          : { ...row }
        return { data: selected.map(pick), error: null }
      }

      const next = new Map([...tables].map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]))
      const target = next.get(table) || []
      next.set(table, target)
      options.control?.writes.push(table)
      const control = options.control
      const writeMode = control?.dropTable === table ? 'drop' : control?.rejectTable === table ? 'reject' : 'ok'
      if (writeMode === 'drop') control.dropTable = null
      if (writeMode === 'reject') control.rejectTable = null
      if (writeMode === 'reject') return { data: null, error: { code: 'write_failed', status: 409 } }
      const pick = (row) => columns && columns !== '*'
        ? Object.fromEntries(columns.split(',').map((column) => [column.trim(), row[column.trim()]]))
        : { ...row }
      let data
      if (mode === 'insert') {
        const row = values.row
        if (target.some((existing) => values.conflict.every((key) => existing[key] === row[key]))) return { data: [], error: null }
        for (const keys of uniqueKeys[table] || []) {
          if (target.some((existing) => keys.every((key) => existing[key] === row[key]))) return { data: null, error: { code: '23505', status: 409 } }
        }
        target.push({ ...row })
        data = [pick(row)]
      } else {
        const matched = target.filter(matches)
        if (mode === 'update') {
          for (const row of matched) Object.assign(row, values.row)
        } else {
          for (const row of matched) target.splice(target.indexOf(row), 1)
        }
        data = matched.map(pick)
      }
      await options.write(next)
      if (writeMode === 'drop') throw new Error('simulated response loss')
      return { data, error: null }
    }
    const chain = {
      select(value) { columns = value; return chain },
      order(column, opts) { orderBy = { column, ascending: opts?.ascending !== false }; return chain },
      range(from, to) { range = { from, to }; return chain },
      limit(count) { maxRows = count; return chain },
      eq(column, value) { filters.push([column, value]); return chain },
      insertIfAbsent(row, opts) { values = { row, conflict: opts.onConflict.split(',').map((key) => key.trim()) }; return chain },
      update(row) { values = { row, conflict: [] }; return chain },
      delete() { return chain },
      then(resolve, reject) {
        execution ||= enqueue(() => options.transaction ? options.transaction(run) : run())
        return execution.then(resolve, reject)
      },
    }
    return chain
  }

  return {
    from(table) {
      return {
        select: (value) => builder(table, 'read').select(value),
        insertIfAbsent: (row, opts) => builder(table, 'insert', { row, conflict: opts.onConflict.split(',').map((key) => key.trim()) }),
        update: (row) => builder(table, 'update', { row, conflict: [] }),
        delete: () => builder(table, 'delete'),
      }
    },
    async dump(table) {
      return enqueue(async () => options.transaction ? options.transaction(async () => [...(await options.read()).get(table) || []].map((row) => ({ ...row }))) : [...(await options.read()).get(table) || []].map((row) => ({ ...row })))
    },
  }
}
