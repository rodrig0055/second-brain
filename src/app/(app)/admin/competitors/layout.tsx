/** Hosts `sheet`: create and edit open in a side panel over this list. */
export default function Layout({
  children,
  sheet,
}: {
  children: React.ReactNode;
  sheet: React.ReactNode;
}) {
  return (
    <>
      {children}
      {sheet}
    </>
  );
}
