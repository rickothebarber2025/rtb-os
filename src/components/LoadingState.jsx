export default function LoadingState({ label = 'Loading RTB OS' }) {
  return (
    <div className="loading-state">
      <div className="loader" />
      <p>{label}</p>
    </div>
  );
}
