-- runemulation.lua
-- run filters in pandoc emulation mode
--
-- Copyright (C) 2022 by RStudio, PBC

local profiler = require('profiler')

local function run_emulated_filter_chain(doc, filters, afterFilterPass, profiling)
  init_trace(doc)
  -- print(os.clock(), " - starting")
  for i, v in ipairs(filters) do
    local function callback()
      if v.flags then
        if type(v.flags) ~= "table" then
          fatal("filter " .. v.name .. " has invalid flags")
        end
        local can_skip = true
        for _, index in ipairs(v.flags) do
          if flags[index] == true then
            can_skip = false
          end
        end
        if can_skip then
          -- print("          - Skipping", v.name)
          return
        end
      end
      -- print(os.clock(), " - running", v.name)

      if profiling then
        profiler.category = v.name
      end

      doc = run_emulated_filter(doc, v.filter)

      add_trace(doc, v.name)

      if profiling then
        profiler.category = ""
      end
    end
    if v.filter.scriptFile then
      _quarto.withScriptFile(v.filter.scriptFile, callback)
    else
      callback()
    end
    if afterFilterPass then
      afterFilterPass()
    end
  end
  end_trace()
  return doc
end

local function emulate_pandoc_filter(filters, afterFilterPass)
  local cached_paths
  local profiler

  local function get_paths(tmpdir)
    if cached_paths then
      return cached_paths
    end
    os.execute("quarto --paths > " .. tmpdir .. "paths.txt")
    local paths_file = io.open(tmpdir .. "paths.txt", "r")
    if paths_file == nil then
      error("couldn't open paths file")
    end
    cached_paths = paths_file:read("l")
    paths_file:close()
    return cached_paths
  end
  
  return {
    traverse = 'topdown',
    Pandoc = function(doc)
      local profiling = option("profiler", false)
      if not profiling then
        return run_emulated_filter_chain(doc, filters, afterFilterPass), false
      end
      if profiler == nil then
        profiler = require('profiler')
      end
      pandoc.system.with_temporary_directory("temp", function(tmpdir)
        profiler.start(tmpdir .. "/prof.txt")
        doc = run_emulated_filter_chain(doc, filters, afterFilterPass, profiling)
        profiler.stop()
        -- os.execute("cp " .. tmpdir .. "/prof.txt /tmp/prof.out")
        local ts_source = get_paths(tmpdir) .. "/../../../tools/profiler/convert-to-perfetto.ts"
        os.execute("quarto run " .. ts_source .. " " .. tmpdir .. "/prof.txt > " .. profiling)
        return nil
      end)
      return doc, false
    end
  }
end

function run_as_extended_ast(specTable)

  local function coalesce_filters(filterList)
    local finalResult = {}
  
    for i, v in ipairs(filterList) do
      if v.filter ~= nil then
        -- v.filter._filter_name = v.name
        table.insert(finalResult, v)
      elseif v.filters ~= nil then
        for j, innerV in pairs(v.filters) do
          innerV._filter_name = string.format("%s-%s", v.name, j)
          table.insert(finalResult, {
            filter = innerV,
            name = innerV._filter_name
          })
        end
      else
        print("Warning: filter " .. v.name .. " didn't declare filter or filters.")
      end
    end
  
    return finalResult
  end

  specTable.filters = coalesce_filters(specTable.filters)

  local pandocFilterList = {}
  if specTable.pre then
    for _, v in ipairs(specTable.pre) do
      table.insert(pandocFilterList, v)
    end
  end

  table.insert(pandocFilterList, emulate_pandoc_filter(
    specTable.filters,
    specTable.afterFilterPass
  ))

  if specTable.post then
    for _, v in ipairs(specTable.post) do
      table.insert(pandocFilterList, v)
    end
  end

  return pandocFilterList
end