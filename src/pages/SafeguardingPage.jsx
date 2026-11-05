import React, { useEffect, useState } from 'react';
import { Download, ExternalLink, FileText, Upload } from 'lucide-react';
import { usePageEditor } from '../utils/PageContentContext';
import { apiUrl } from '../utils/api';
import { listSafeguardingDocuments, uploadSafeguardingDocument } from '../utils/safeguardingDocuments';
import { SAFEGUARDING_POLICIES, safeguardingPolicyPath } from '../utils/safeguardingPolicies';

const DocumentActions = ({ title, openUrl, downloadUrl, filename }) => <div className="SafeguardingDocumentActions">
  <a className="PrimaryActionButtonCompact" href={openUrl} target="_blank" rel="noreferrer" aria-label={`Open ${title} PDF in a new tab`}>
    <ExternalLink className="IconSm" /> Open PDF
  </a>
  <a className="PrimaryActionButtonCompact" href={downloadUrl} download={filename} aria-label={`Download ${title} PDF`}>
    <Download className="IconSm" /> Download
  </a>
</div>;

export default function SafeguardingPage() {
  const { adminUser } = usePageEditor();
  const [documents, setDocuments] = useState([]);
  const [selected, setSelected] = useState(null);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refreshDocuments = () => listSafeguardingDocuments()
    .then((items) => {
      setDocuments(items);
      setLoadError('');
    })
    .catch((documentError) => setLoadError(documentError.message))
    .finally(() => setLoading(false));

  useEffect(() => { refreshDocuments(); }, []);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setUploading(true);
    try {
      await uploadSafeguardingDocument({ file, title, replaceName: selected?.name || '' });
      setMessage(selected ? 'Safeguarding document replaced.' : 'Safeguarding document uploaded.');
      setSelected(null);
      setTitle('');
      setFile(null);
      setFileInputKey((key) => key + 1);
      await refreshDocuments();
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading(false);
    }
  };

  return <div className="SectionContent PageFadeIn">
    <h2 className="page_heading_bold_1">Safeguarding</h2>
    <section className="main_tile main_tile_grey">
      <h3 className="tile_heading_bold_2">Report a concern</h3>
      <p className="text_container"><strong>If someone is in immediate danger, call 999.</strong></p>
      <p className="text_container SpaceT3">For a safeguarding concern, contact the club’s Safeguarding Officer at <a href="mailto:safeguarding@forthcanoeclub.co.uk">safeguarding@forthcanoeclub.co.uk</a> or the deputy at <a href="mailto:Safety@forthcanoeclub.co.uk">Safety@forthcanoeclub.co.uk</a>. The general <a href="/contact-us">Contact Us page</a> is not a confidential safeguarding reporting route.</p>
      <h4 className="tile_heading_bold_2 SpaceT4">Independent support</h4>
      <p className="text_container">For concerns about a child or an adult’s behaviour in sport, contact the <a href="https://www.children1st.org.uk/for-professionals/child-wellbeing-and-protection-in-sport/" target="_blank" rel="noreferrer">Child Wellbeing and Protection in Sport service</a> on <a href="tel:01414191156">0141 419 1156</a> or <a href="mailto:cwps@children1st.org.uk">cwps@children1st.org.uk</a>.</p>
      <p className="text_container SpaceT3">For adult safeguarding guidance in sport, see the <a href="https://www.anncrafttrust.org/safeguarding-adults-sport-activity/" target="_blank" rel="noreferrer">Ann Craft Trust</a>. Further Scottish sport safeguarding guidance is available from <a href="https://sportscotland.org.uk/safeguarding-in-sport" target="_blank" rel="noreferrer">sportscotland</a>.</p>
    </section>

    <section className="SpaceT6">
      <h3 className="tile_heading_bold_1">Safeguarding documents</h3>
      <ul className="text_container SpaceY2 SafeguardingDownloads">
        {SAFEGUARDING_POLICIES.map((policy) => <li key={policy.id}>
          <FileText className="IconSm" />
          <div>
            <p><strong>{policy.title}</strong></p>
            <p>{policy.detail}</p>
            <DocumentActions title={policy.title} filename={policy.filename}
              openUrl={apiUrl(safeguardingPolicyPath(policy.id))}
              downloadUrl={apiUrl(safeguardingPolicyPath(policy.id, { download: true }))} />
          </div>
        </li>)}
        {documents.map((document) => <li key={document.name}>
          <FileText className="IconSm" />
          <div>
            <p><strong>{document.title}</strong></p>
            <DocumentActions title={document.title} filename={`${document.title}.pdf`} openUrl={document.url} downloadUrl={document.url} />
          </div>
        </li>)}
      </ul>
      {loading && <p className="text_container" role="status">Checking for additional club documents…</p>}
      {loadError && <p className="StatusTextError" role="alert">Additional club documents could not be loaded: {loadError}</p>}
    </section>

    {adminUser ? <section className="main_tile SpaceT6">
      <h3 className="tile_heading_bold_2">Manage safeguarding documents</h3>
      <p className="text_container">Upload a PDF or replace an existing document. Changes are visible to visitors as soon as the upload succeeds.</p>
      <form className="FormContainer FormBody SpaceT4" onSubmit={submit}>
        <label className="FormLabel">Document title
          <input className="FormInput" required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="FormLabel">Replace existing document (optional)
          <select className="FormInput" value={selected?.name || ''} onChange={(event) => {
            const next = documents.find((document) => document.name === event.target.value) || null;
            setSelected(next);
            if (next) setTitle(next.title);
          }}>
            <option value="">Upload a new document</option>
            {documents.map((document) => <option key={document.name} value={document.name}>{document.title}</option>)}
          </select>
        </label>
        <label className="FormLabel">PDF document (10 MB maximum)
          <input key={fileInputKey} className="FormInput" type="file" accept="application/pdf,.pdf" required disabled={uploading}
            onChange={(event) => setFile(event.target.files?.[0] || null)} />
        </label>
        <button className="FormSubmitButton" type="submit" disabled={uploading || !file}>
          <Upload className="IconMd" /> {uploading ? 'Uploading…' : selected ? 'Replace document' : 'Upload document'}
        </button>
        {error && <p className="StatusTextError" role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
      </form>
    </section> : <p className="text_container SpaceT6">Committee admins can sign in through the <a href="/admin">Admin page</a> to upload or replace safeguarding documents.</p>}
  </div>;
}
