import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { Dialog, ErrorState } from '../components';

/**
 * A patient summary, ready to print, copy or download.
 *
 * The PDF comes from the browser's own print dialogue rather than a PDF
 * library. That is a deliberate dependency choice: a clinical system should
 * carry as little unpatched native code as possible, every browser already
 * produces good PDFs, and the print stylesheet is inspectable by anyone
 * reviewing what leaves the building.
 */

type Format = 'markdown' | 'fhir';

/** Renders the small subset of markdown the report actually produces. */
function renderMarkdown(source: string): string {
  const escape = (t: string) =>
    t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const inline = (t: string) =>
    escape(t)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code>$1</code>');

  const out: string[] = [];
  let inTable = false;
  let listOpen = false;

  const closeList = () => {
    if (listOpen) {
      out.push('</ul>');
      listOpen = false;
    }
  };
  const closeTable = () => {
    if (inTable) {
      out.push('</tbody></table>');
      inTable = false;
    }
  };

  for (const raw of source.split('\n')) {
    const line = raw.trimEnd();

    if (line.startsWith('### ')) {
      closeList();
      closeTable();
      out.push(`<h3>${inline(line.slice(4))}</h3>`);
    } else if (line.startsWith('## ')) {
      closeList();
      closeTable();
      out.push(`<h2>${inline(line.slice(3))}</h2>`);
    } else if (line.startsWith('# ')) {
      closeList();
      closeTable();
      out.push(`<h1>${inline(line.slice(2))}</h1>`);
    } else if (line === '---') {
      closeList();
      closeTable();
      out.push('<hr />');
    } else if (/^\|[- |]+\|$/.test(line)) {
      // The header separator row: opens the body rather than printing dashes.
      if (inTable) out.push('<tbody>');
    } else if (line.startsWith('|')) {
      const cells = line.slice(1, -1).split('|').map((c) => c.trim());
      if (!inTable) {
        closeList();
        out.push('<table><thead>');
        out.push(`<tr>${cells.map((c) => `<th>${inline(c)}</th>`).join('')}</tr>`);
        out.push('</thead>');
        inTable = true;
      } else {
        out.push(`<tr>${cells.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`);
      }
    } else if (line.startsWith('  - ')) {
      out.push(`<li class="sub">${inline(line.slice(4))}</li>`);
    } else if (line.startsWith('- ')) {
      closeTable();
      if (!listOpen) {
        out.push('<ul>');
        listOpen = true;
      }
      out.push(`<li>${inline(line.slice(2))}</li>`);
    } else if (line === '') {
      closeList();
      closeTable();
    } else {
      closeList();
      closeTable();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  closeTable();
  return out.join('\n');
}

export function PatientReport({
  patientId,
  patientName,
  onClose,
}: {
  patientId: string;
  patientName: string;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<Format>('markdown');
  const [markdown, setMarkdown] = useState('');
  const [fhir, setFhir] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setError(null);
    api
      .report(patientId, format)
      .then((r) => {
        if (format === 'fhir') setFhir(JSON.stringify(r, null, 2));
        else setMarkdown((r as { markdown: string }).markdown);
      })
      .catch((e: ApiError) => setError(e.message));
  }, [patientId, format]);

  const text = format === 'fhir' ? fhir : markdown;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy. Select the text and copy it by hand.');
    }
  };

  const download = () => {
    const blob = new Blob([text], {
      type: format === 'fhir' ? 'application/fhir+json' : 'text/markdown',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safe = patientName.replace(/[^\w-]+/g, '-').toLowerCase();
    link.download = `${safe}-summary.${format === 'fhir' ? 'json' : 'md'}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog title={`Summary for ${patientName}`} onClose={onClose} wide>
      <div className="row no-print">
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as Format)}
          aria-label="Report format"
          style={{ width: 'auto' }}
        >
          <option value="markdown">Clinical summary</option>
          <option value="fhir">FHIR bundle (JSON)</option>
        </select>

        <button className="primary" onClick={() => window.print()} disabled={!text}>
          Print or save as PDF
        </button>
        <button onClick={copy} disabled={!text}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button onClick={download} disabled={!text}>
          Download
        </button>
      </div>

      <p className="hint no-print">
        {format === 'fhir'
          ? 'A FHIR R4 bundle for import into another system. Conditions and medications carry text rather than codes — this record stores them as text, and emitting a code the clinician never chose would be inventing clinical data.'
          : 'Printing uses your browser, so “Save as PDF” in the print dialogue produces the file.'}
      </p>

      {error && <ErrorState message={error} />}

      {!error && !text && <div className="hint">Preparing the summary…</div>}

      {text &&
        (format === 'fhir' ? (
          <pre className="report-json">{fhir}</pre>
        ) : (
          <div
            className="report-page"
            // The markdown is generated by this application from its own
            // database and rendered by the reader above, which escapes every
            // value before any tag is added. No user input reaches it unescaped.
            dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
          />
        ))}
    </Dialog>
  );
}
