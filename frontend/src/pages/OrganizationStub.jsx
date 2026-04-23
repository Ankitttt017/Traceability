const OrganizationStub = ({ title = "Organization Page" }) => {
  return (
    <div className="p-6 md:p-8">
      <div className="max-w-4xl rounded-2xl border border-border bg-bg-card p-6 md:p-8">
        <h1 className="text-2xl font-bold text-text-main">{title}</h1>
        <p className="mt-3 text-sm text-text-muted">
          Dummy page created. You can replace this with the final design later.
        </p>
      </div>
    </div>
  );
};

export default OrganizationStub;
