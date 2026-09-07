/**
 * Scientific Agent Skills Loader
 * Discovers and registers skills from the scientific-agent-skills repo as DSH tools.
 */
import type { Context, Service } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from 'schemastery'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

export interface SkillMetadata {
  name: string
  description: string
  license: string
  metadata: {
    version: string
    'skill-author': string
    [key: string]: unknown
  }
}

export interface SkillInfo {
  metadata: SkillMetadata
  path: string
  scripts: string[]
  references: string[]
  assets: string[]
}

/**
 * Parse YAML frontmatter from SKILL.md
 */
export function parseSkillFrontmatter(content: string): SkillMetadata | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!frontmatterMatch) return null
  
  try {
    // Simple YAML parser for the known frontmatter structure
    const yaml = frontmatterMatch[1]
    const metadata: Record<string, unknown> = {}
    let currentKey = ''
    let inMultiline = false
    let multilineKey = ''
    let multilineValue = ''
    
    for (const line of yaml.split('\n')) {
      if (inMultiline) {
        if (line.startsWith('  ') || line.startsWith('\t')) {
          multilineValue += '\n' + line.trimStart()
        } else {
          metadata[multilineKey] = multilineValue.trim()
          inMultiline = false
          // re-process this line
          if (line.includes(':')) {
            const [key, ...rest] = line.split(':')
            currentKey = key.trim()
            const value = rest.join(':').trim()
            if (value.startsWith('|') || value.startsWith('>')) {
              inMultiline = true
              multilineKey = currentKey
              multilineValue = ''
            } else {
              metadata[currentKey] = parseYamlValue(value)
            }
          }
        }
        continue
      }
      
      if (line.includes(':')) {
        const [key, ...rest] = line.split(':')
        currentKey = key.trim()
        const value = rest.join(':').trim()
        if (value.startsWith('|') || value.startsWith('>')) {
          inMultiline = true
          multilineKey = currentKey
          multilineValue = ''
        } else {
          metadata[currentKey] = parseYamlValue(value)
        }
      }
    }
    
    if (inMultiline) {
      metadata[multilineKey] = multilineValue.trim()
    }
    
    return {
      name: String(metadata.name || ''),
      description: String(metadata.description || ''),
      license: String(metadata.license || 'MIT'),
      metadata: {
        version: String(metadata.metadata?.version || '1.0'),
        'skill-author': String(metadata.metadata?.['skill-author'] || ''),
        ...metadata.metadata
      }
    }
  } catch {
    return null
  }
}

function parseYamlValue(value: string): unknown {
  if (value === 'true' || value === 'false') return value === 'true'
  if (/^\d+$/.test(value)) return parseInt(value, 10)
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value)
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1)
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1)
  return value
}

/**
 * Discover all available skills in the skills directory
 */
export async function discoverSkills(skillsRoot: string): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = []
  
  try {
    const entries = await readdir(skillsRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      
      const skillPath = join(skillsRoot, entry.name)
      const skillMdPath = join(skillPath, 'SKILL.md')
      
      let metadata: SkillMetadata | null = null
      try {
        const content = await readFile(skillMdPath, 'utf-8')
        metadata = parseSkillFrontmatter(content)
      } catch {
        continue // Skip skills without SKILL.md
      }
      
      if (!metadata) continue
      
      // Discover scripts, references, assets
      const [scripts, references, assets] = await Promise.all([
        listDir(join(skillPath, 'scripts'), '.py'),
        listDir(join(skillPath, 'references'), '.md'),
        listDir(join(skillPath, 'assets'))
      ])
      
      skills.push({
        metadata,
        path: skillPath,
        scripts,
        references,
        assets
      })
    }
  } catch (error) {
    console.error('[scientific-skills] Failed to discover skills:', error)
  }
  
  return skills
}

async function listDir(dir: string, ext?: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter(e => e.isFile() && (!ext || e.name.endsWith(ext)))
      .map(e => e.name)
      .sort()
  } catch {
    return []
  }
}

/**
 * Execute a skill script via Python subprocess
 */
export async function runSkillScript(
  skillPath: string,
  scriptName: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const scriptPath = join(skillPath, 'scripts', scriptName)
  
  return new Promise((resolve) => {
    const proc = spawn('python', [scriptPath, ...args], {
      cwd: skillPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONPATH: skillPath }
    })
    
    let stdout = ''
    let stderr = ''
    
    proc.stdout?.on('data', (data) => { stdout += data.toString() })
    proc.stderr?.on('data', (data) => { stderr += data.toString() })
    
    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 })
    })
    
    proc.on('error', (err) => {
      resolve({ stdout, stderr: err.message, exitCode: 1 })
    })
    
    // 5-minute timeout
    setTimeout(() => {
      proc.kill('SIGTERM')
      resolve({ stdout, stderr: 'Timeout after 5 minutes', exitCode: 124 })
    }, 300000)
  })
}

/**
 * Build tool schema for a skill based on its scripts
 */
export function buildSkillToolSchema(skill: SkillInfo): z.Schema {
  const scriptChoices = skill.scripts.length > 0 
    ? skill.scripts 
    : ['run_pipeline.py'] // default fallback
  
  return z.object({
    script: z.enum(scriptChoices as [string, ...string[]]).default(scriptChoices[0]).describe(
      'Script to run. Available: ' + scriptChoices.join(', ')
    ),
    args: z.array(z.string()).default([]).describe('Command-line arguments for the script'),
    input_file: z.string().optional().describe('Input file path (relative to skill dir or absolute)'),
    output_file: z.string().optional().describe('Output file path (relative to skill dir or absolute)')
  })
}

/**
 * Register all skills as DSH tools
 */
export async function registerSkills(
  ctx: Context,
  skillsRoot: string,
  options?: { enabledSkills?: string[] }
): Promise<SkillInfo[]> {
  const skills = await discoverSkills(skillsRoot)
  const enabled = options?.enabledSkills ? new Set(options.enabledSkills) : null
  
  for (const skill of skills) {
    if (enabled && !enabled.has(skill.metadata.name)) continue
    
    const toolName = 'skill.' + skill.metadata.name
    const schema = buildSkillToolSchema(skill)
    
    ctx.effect(() => ctx.tools.register(defineTool({
      name: toolName,
      description: skill.metadata.description + ' (scientific-agent-skills v' + skill.metadata.metadata.version + ')',
      parameters: schema,
      output: {
        schema: z.object({
          stdout: z.string(),
          stderr: z.string(),
          exitCode: z.number(),
          skill: z.string(),
          script: z.string()
        }),
        render: (_args, value) => [{
          type: 'text',
          text: '[' + value.skill + '] ' + value.script + ' (exit ' + value.exitCode + ')\n' + value.stdout + (value.stderr ? '\nSTDERR:\n' + value.stderr : '')
        }]
      },
      async execute(args) {
        const script = args.script || skill.scripts[0] || 'run_pipeline.py'
        const scriptArgs = [
          ...(args.input_file ? [args.input_file] : []),
          ...(args.output_file ? ['-o', args.output_file] : []),
          ...args.args
        ]
        
        const result = await runSkillScript(skill.path, script, scriptArgs)
        
        return {
          ...result,
          skill: skill.metadata.name,
          script
        }
      }
    })), '@dsh-external/dsh-scientific-skills: ' + toolName)
  }
  
  return skills
}
