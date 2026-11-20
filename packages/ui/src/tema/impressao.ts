// Impresso sempre claro: além do @media print da folha de tokens, a classe do modo escuro sai durante a
// impressão (o tema do OpenVue também depende dela) e volta depois.
import { CLASSE_ESCURO } from './css.js';

export function protegerImpressao(janela: Window = window): () => void {
  const raiz = janela.document.documentElement;
  let estavaEscuro = false;
  const antes = () => {
    estavaEscuro = raiz.classList.contains(CLASSE_ESCURO);
    raiz.classList.remove(CLASSE_ESCURO);
  };
  const depois = () => {
    if (estavaEscuro) raiz.classList.add(CLASSE_ESCURO);
    estavaEscuro = false;
  };
  janela.addEventListener('beforeprint', antes);
  janela.addEventListener('afterprint', depois);
  return () => {
    janela.removeEventListener('beforeprint', antes);
    janela.removeEventListener('afterprint', depois);
  };
}
