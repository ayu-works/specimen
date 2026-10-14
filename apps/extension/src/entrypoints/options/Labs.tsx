import { useEffect, useState } from 'react';
import { Card, CardTitle } from '@/components/ui/card';
import { loadFlag, setFlag, watchFlag } from '@/lib/flags';

/** Experimental switches. Rendered only when the page is opened with `?labs=1`. */
export function Labs() {
  const [critique, setCritique] = useState(false);
  useEffect(() => {
    void loadFlag('critique').then(setCritique);
    return watchFlag('critique', setCritique);
  }, []);
  return (
    <Card className="flex flex-col gap-2" data-testid="labs">
      <CardTitle className="mb-0">Labs</CardTitle>
      <p className="text-muted-foreground">
        Unfinished experiments. They use your AI provider and may change or disappear.
      </p>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={critique}
          onChange={(e) => void setFlag('critique', e.target.checked)}
        />
        Critique panel: AI reviewers discuss a scan (adds a Critique tab to the side panel)
      </label>
    </Card>
  );
}
