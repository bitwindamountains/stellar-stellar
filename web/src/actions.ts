import { supabase } from './supabase'

/** Ask the publisher to run now. Without the dispatch function deployed, the next 30-minute run picks it up. */
export async function publishSoon(): Promise<void> {
  await supabase.functions.invoke('dispatch').catch(() => undefined)
}

/** Requeue a failed or missed post to go out now. Platforms that already have an ID are never posted again. */
export async function retryNow(num: number): Promise<string | null> {
  const { error } = await supabase
    .from('posts')
    .update({ status: 'scheduled', publish_at: new Date().toISOString(), attempts: 0, last_error: '', claimed_at: null })
    .eq('num', num)
    .in('status', ['failed', 'missed'])
  if (error) return error.message
  await publishSoon()
  return null
}
