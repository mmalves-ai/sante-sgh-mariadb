// Contrato do SanteDialogoGravacao (X-01): o pedido que a tela monta para cada gravação que pede motivo e/ou senha.
import { tipoDoProblema } from '@sgh/contratos';

export interface PedidoGravacao {
  titulo: string;
  texto?: string;
  /** Rótulo do campo do motivo; ausente: sem motivo. */
  motivo?: string;
  motivoObrigatorio?: boolean;
  /** Pede a senha de novo (reautenticação, SBIS-07). */
  senha: boolean;
  confirmar: string;
  /** Aviso extra (ex.: o profissional sem registro ativo não fará ato de profissional). */
  alerta?: string;
  gravar: (x: { motivo: string; senha: string }) => Promise<unknown>;
}

/** Os data-testid do diálogo (cada tela pode manter os seus). */
export interface TestidsGravacao {
  form: string;
  alerta: string;
  erro: string;
  motivo: string;
  senha: string;
  confirmar: string;
}

export const TESTIDS_GRAVACAO: TestidsGravacao = {
  form: 'form-gravacao',
  alerta: 'dialogo-alerta',
  erro: 'dialogo-senha-erro',
  motivo: 'dialogo-motivo',
  senha: 'dialogo-senha',
  confirmar: 'dialogo-confirmar',
};

/** Erro da API como a casca o lança (status + problem details), sem depender da classe do app. */
interface ErroComProblema {
  status: number;
  problema: { type: string; title?: string; detail?: string } | null;
}
function ehErroApi(e: unknown): e is ErroComProblema {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as ErroComProblema).status === 'number' &&
    'problema' in e
  );
}

/**
 * Senha que não confere (ou tentativas demais): o problema se resolve DENTRO do diálogo.
 * Devolve 'senha' (texto padrão), o texto do servidor (tentativas demais) ou null (vai para a tela).
 */
export function problemaDeSenha(e: unknown): 'senha' | { texto: string } | null {
  if (!ehErroApi(e)) return null;
  const tipo = e.problema ? tipoDoProblema(e.problema) : null;
  if (tipo === 'reautenticacao-necessaria' || (tipo === null && e.status === 401)) return 'senha';
  if (tipo === 'muitas-tentativas') {
    const texto = e.problema?.detail || e.problema?.title;
    return texto ? { texto } : 'senha';
  }
  return null;
}
