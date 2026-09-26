export function DailyQuiz({ question }: { question: string }) {
  return (
    <section>
      <h2>Quiz du jour</h2>
      <p>{question}</p>
      <p>Les réponses depuis le dashboard arrivent bientôt.</p>
    </section>
  );
}
