// Paleta de comandos (Ctrl+K): provedores de busca por módulo: "telas", "ações" e "pacientes" (M11: a busca
// do cadastro com o termo; M15: o prontuário ao vivo com o termo). Cada resultado exige a permissão do destino; a busca ignora
// acento e maiúsculas (porta de normalizarChave da sante-api).
import { casaBusca, normalizarChave } from '@sgh/contratos';

export type GrupoBusca = 'telas' | 'acoes' | 'pacientes';

export interface ResultadoBusca {
  readonly id: string;
  readonly grupo: GrupoBusca;
  readonly titulo: string;
  /** Caminho ou explicação curta (ex.: "Início > Preferências do usuário"). */
  readonly detalhe: string;
  /** Permissão exigida pelo destino (null = ação da casca, sem dado). */
  readonly permissao: string | null;
  readonly executar: () => void;
}

export interface ProvedorBusca {
  readonly id: string;
  readonly grupo: GrupoBusca;
  /** Candidatos (o filtro por texto e por permissão é feito por buscar()). */
  candidatos(): readonly ResultadoBusca[];
  /**
   * M11: resultados que dependem do termo (ex.: "Buscar paciente: <termo>", que abre a busca do cadastro com
   * o termo). Passam só pelo filtro de permissão; nenhum dado de paciente entra na paleta.
   */
  doTermo?(termo: string): readonly ResultadoBusca[];
}

/** Pacientes (M11: atalho para a busca do cadastro com o termo; M15: para a busca do prontuário ao vivo). */
export type ProvedorPacientes = ProvedorBusca & { readonly grupo: 'pacientes' };

export const ORDEM_GRUPOS: readonly GrupoBusca[] = ['pacientes', 'telas', 'acoes'];
export const LIMITE_POR_GRUPO = 20;

export class RegistroDeProvedores {
  private readonly provedores = new Map<string, ProvedorBusca>();

  registrar(p: ProvedorBusca): () => void {
    this.provedores.set(p.id, p);
    return () => {
      this.provedores.delete(p.id);
    };
  }

  buscar(termo: string, permissoes: ReadonlySet<string>): ResultadoBusca[] {
    const resultados: ResultadoBusca[] = [];
    for (const grupo of ORDEM_GRUPOS) {
      const doGrupo = [...this.provedores.values()]
        .filter((p) => p.grupo === grupo)
        .flatMap((p) => p.candidatos())
        .filter((r) => r.permissao === null || permissoes.has(r.permissao))
        .filter((r) => casaBusca(`${r.titulo} ${r.detalhe}`, termo))
        .sort((a, b) => pontuar(b, termo) - pontuar(a, termo));
      const doTermo = [...this.provedores.values()]
        .filter((p) => p.grupo === grupo && p.doTermo)
        .flatMap((p) => p.doTermo!(termo))
        .filter((r) => r.permissao === null || permissoes.has(r.permissao));
      resultados.push(...[...doTermo, ...doGrupo].slice(0, LIMITE_POR_GRUPO));
    }
    return resultados;
  }
}

/** Título que começa pelo termo vem antes. */
function pontuar(r: ResultadoBusca, termo: string): number {
  const t = normalizarChave(termo);
  if (t === '') return 0;
  const titulo = normalizarChave(r.titulo);
  return titulo.startsWith(t) ? 2 : titulo.includes(t) ? 1 : 0;
}

export const provedores = new RegistroDeProvedores();
