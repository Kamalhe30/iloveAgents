
import { supabase } from '../lib/supabase'

/**
 * Get the currently authenticated user's ID.
 * Returns null if no user is logged in.
 */
async function getCurrentUserId() {
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) return null

    return user.id
  } catch (err) {
    console.warn('Failed to get current user:', err)
    return null
  }
}

/**
 * Fetch all public workflows, newest first.
 */
export async function fetchWorkflows() {
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('is_public', true)
    .order('created_at', { ascending: false })

  return {
    data: data ?? [],
    error,
  }
}

/**
 * Fetch one workflow by ID.
 */
export async function fetchWorkflowById(id) {
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  return {
    data: data ?? null,
    error,
  }
}

/**
 * Save a new workflow.
 */
export async function saveWorkflow(workflow) {
  const userId = await getCurrentUserId()

  if (!userId) {
    return {
      data: null,
      error: {
        message: 'User must be authenticated to save workflows. Please log in first.',
      },
    }
  }

  if (!workflow?.title || !Array.isArray(workflow.agents)) {
    return {
      data: null,
      error: {
        message: 'A workflow title and valid agents array are required.',
      },
    }
  }

  const { data, error } = await supabase
    .from('workflows')
    .insert({
      user_id: userId,
      title: workflow.title,
      description: workflow.description || '',
      agents: workflow.agents,
      is_public: true,
      usage_count: 0,
    })
    .select()
    .single()

  return {
    data: data ?? null,
    error,
  }
}

/**
 * Update an existing workflow.
 * Only the owner can update it.
 */
export async function updateWorkflow(id, updates) {
  const userId = await getCurrentUserId()

  if (!userId) {
    return {
      data: null,
      error: {
        message: 'User must be authenticated to update workflows.',
      },
    }
  }

  // Only allow these fields to be updated.
  // Never allow user_id or other protected fields from the client.
  const allowedFields = [
    'title',
    'description',
    'agents',
    'is_public',
  ]

  const safeUpdates = {}

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(updates, field)) {
      safeUpdates[field] = updates[field]
    }
  }

  if (Object.keys(safeUpdates).length === 0) {
    return {
      data: null,
      error: {
        message: 'No valid fields provided for update.',
      },
    }
  }

  const { data, error } = await supabase
    .from('workflows')
    .update(safeUpdates)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .maybeSingle()

  if (error) {
    return {
      data: null,
      error,
    }
  }

  if (!data) {
    return {
      data: null,
      error: {
        message: 'Workflow not found or you do not have permission to update it.',
      },
    }
  }

  return {
    data,
    error: null,
  }
}

/**
 * Delete an existing workflow.
 * Only the owner can delete it.
 */
export async function deleteWorkflow(id) {
  const userId = await getCurrentUserId()

  if (!userId) {
    return {
      error: {
        message: 'User must be authenticated to delete workflows.',
      },
    }
  }

  const { data, error } = await supabase
    .from('workflows')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle()

  if (error) {
    return { error }
  }

  if (!data) {
    return {
      error: {
        message: 'Workflow not found or you do not have permission to delete it.',
      },
    }
  }

  return { error: null }
}

/**
 * Increment a workflow's usage count using an atomic database function.
 */
export async function incrementUsage(id) {
  const { error } = await supabase.rpc(
    'increment_workflow_usage',
    {
      workflow_id: id,
    }
  )

  if (error) {
    console.error('Failed to increment workflow usage:', error)
  }

  return { error }
}

/**
 * Subscribe to realtime updates for one workflow.
 */
export function subscribeToWorkflow(workflowId, callback) {
  return supabase
    .channel(`workflow-usage-${workflowId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'workflows',
        filter: `id=eq.${workflowId}`,
      },
      (payload) => callback(payload)
    )
    .subscribe()
}

/**
 * Subscribe to realtime updates for all public workflows.
 */
export function subscribeToAllWorkflows(callback) {
  return supabase
    .channel('workflow-usage-all')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'workflows',
      },
      (payload) => callback(payload)
    )
    .subscribe()
}
