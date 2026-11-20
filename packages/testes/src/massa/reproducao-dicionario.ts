// Reprodução dos cenários do dicionário ortográfico pessoal (M27) pelo EXECUTOR, na transação da captura (sempre
// desfeita): o operador sintético (criado pelo executor, acesso.criarUsuarioIntegracao) é o dono do dicionário; a
// palavra é sintética (letras sem sentido, prefixo "sghrepro"); a de partida da exclusão e da recusa de repetida é
// incluída pelo próprio executor na preparação, antes do retrato. Nenhum dado real.
import { type CenarioCaptura, ErroOperacao, type Escritor } from '@sgh/legado';

type Executar = (e: Escritor, entrada: unknown) => Promise<unknown>;
type ExecutarOutra = (e: Escritor, nome: string, entrada: unknown) => Promise<unknown>;

export const OPERACOES_REPRODUCAO_DICIONARIO = new Set([
  'acesso.incluirPalavraDicionario',
  'acesso.excluirPalavraDicionario',
]);

let seq = 0;
/** Palavra sintética só de letras (o esquema recusa dígito): "sghrepro" + letras do relógio. */
export function palavraSintetica(): string {
  const n = Date.now() * 37 + seq++;
  return `sghrepro${n
    .toString(26)
    .split('')
    .map((d) => String.fromCharCode(97 + parseInt(d, 26)))
    .join('')
    .slice(-10)}`;
}

async function exigirRecusa(p: Promise<unknown>, codigo: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao && e.problema.codigo === codigo) return;
    throw e;
  }
  throw new Error(`Cenário de recusa: esperava ${codigo}, a operação gravou.`);
}

export function cenarioDicionario(
  nome: string,
  cenario: string,
  base: Pick<CenarioCaptura, 'operacao' | 'cenario' | 'tabelas'>,
  executar: Executar,
  executarOutra: ExecutarOutra,
  operadorSintetico: (e: Escritor) => Promise<string>,
): CenarioCaptura {
  const entrada = { palavra: palavraSintetica() };
  const chave = `${nome}/${cenario}`;
  return {
    ...base,
    async preparar(e) {
      await operadorSintetico(e);
      if (
        chave === 'acesso.incluirPalavraDicionario/recusa-ja-existe' ||
        chave === 'acesso.excluirPalavraDicionario/excluir'
      )
        await executarOutra(e, 'acesso.incluirPalavraDicionario', entrada);
    },
    async executar(e) {
      switch (chave) {
        case 'acesso.incluirPalavraDicionario/incluir':
        case 'acesso.excluirPalavraDicionario/excluir':
          await executar(e, entrada);
          return;
        case 'acesso.incluirPalavraDicionario/recusa-ja-existe':
          await exigirRecusa(executar(e, entrada), 'palavra-existente');
          return;
        case 'acesso.excluirPalavraDicionario/recusa-inexistente':
          await exigirRecusa(executar(e, entrada), 'palavra-inexistente');
          return;
        default:
          throw new Error(`Cenário ${chave} sem reprodução.`);
      }
    },
  };
}
