// W0-09 (programa CRUD completo; script 1123; D-RETRO-REGISTRO-F6): o registro do fim da coexistência (M43) e o da
// retrocompatibilidade (M59, etapa 6) gravados pela tela. Os dois caminhos estão construídos; o parâmetro
// coexistencia.registro.modo escolhe:
//   - 'tela' (padrão): cada gravação (com a senha de novo, pelo controlador, e o motivo) é uma versão nova em
//     SGH_CFG_COEX_REGISTRO (só inclusão) com a SGH_TRILHA na mesma transação; a mais nova vale sobre o registro
//     versionado; gravar `conteudo: null` volta a valer o arquivo (a versão anterior fica no histórico);
//   - 'excecao': vale só o registro versionado (por PR); a gravação é recusada (409) e as versões gravadas são
//     ignoradas na leitura. A falha da leitura do parâmetro também vale 'excecao' (falha fechada: nada se grava).
// O conteúdo é validado pelo esquema do próprio registro (o mesmo do arquivo) e tem de ser do estabelecimento.
import {
  definicaoParametro,
  esquemaGravarRegistroCoex,
  esquemaRegistroFimCoexistencia,
  esquemaRegistroRetrocompatibilidade,
  EVENTOS_AUDITAVEIS,
  type ModoRegistroCoex,
  PARAMETRO_REGISTRO_COEX,
  type RegistroCoexGravado,
  TETO_REGISTRO_COEX,
  TIPOS_REGISTRO_COEX,
  type TipoRegistroCoex,
} from '@sgh/contratos';
import { resolverParametro, valorTipado } from '@sgh/dominio-config';
import { jsonAscii } from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import { linhaTrilha, type SessaoCadastro } from '../../cadastro/comum.js';
import type { FonteConfiguracao } from '../../config/configuracao-fonte.js';
import type { ContextoCoex, PortaCoexistencia } from '../porta.js';

/** O registro gravado que vale agora para o hospital (null: vale o arquivo versionado). */
export type RegistroGravadoCoex = (
  c: ContextoCoex,
  tipo: TipoRegistroCoex,
) => Promise<Record<string, unknown> | null>;

/** Sem a fonte ou com erro, vale o arquivo (a leitura do painel nunca cai por causa do registro gravado). */
export async function gravadoOuArquivo(
  f: RegistroGravadoCoex | undefined,
  c: ContextoCoex,
  tipo: TipoRegistroCoex,
): Promise<Record<string, unknown> | null> {
  if (!f) return null;
  try {
    return await f(c, tipo);
  } catch {
    return null;
  }
}

/** O modo do estabelecimento pela fonte de configuração; sem fonte ou com erro, 'excecao' (falha fechada). */
export function modoRegistroPelaConfiguracao(
  fonte: () => Pick<FonteConfiguracao, 'valoresParametro'> | null,
  agora: () => number = () => Date.now(),
): (rede: string, hospital: string) => Promise<ModoRegistroCoex> {
  return async (rede, hospital) => {
    const def = definicaoParametro(PARAMETRO_REGISTRO_COEX);
    const f = fonte();
    if (!def || !f) return 'excecao';
    try {
      const valores = await f.valoresParametro(rede, hospital);
      const v = valorTipado(
        def,
        resolverParametro(
          def,
          valores,
          { rede, empresa: null, estabelecimento: hospital, unidade: null, perfis: [], usuario: '' },
          new Date(agora()),
        ).valor,
      );
      return v === 'tela' ? 'tela' : 'excecao';
    } catch {
      return 'excecao';
    }
  };
}

const naoEncontrado = () => new ErroProblema('nao-encontrado', 404, 'Registro não encontrado');
const invalido = (detalhe: string) => new ErroProblema('entrada-invalida', 400, 'Dados inválidos', detalhe);

const tipoDe = (t: string): TipoRegistroCoex => {
  if (!(TIPOS_REGISTRO_COEX as readonly string[]).includes(t)) throw naoEncontrado();
  return t as TipoRegistroCoex;
};

const esquemaDo = (t: TipoRegistroCoex) =>
  t === 'fim' ? esquemaRegistroFimCoexistencia : esquemaRegistroRetrocompatibilidade;

export class ServicoRegistroCoex {
  constructor(
    private readonly porta: PortaCoexistencia,
    private readonly modo: (rede: string, hospital: string) => Promise<ModoRegistroCoex>,
  ) {}

  /** A fonte para os painéis (fim, desligamento, retrocompatibilidade). */
  readonly vigente: RegistroGravadoCoex = async (c, tipo) => {
    if ((await this.modo(c.rede, c.hospital)) !== 'tela') return null;
    const [v] = await this.porta.versoesRegistro(c, tipo);
    return v?.conteudo ?? null;
  };

  async ler(s: SessaoCadastro, tipoBruto: string): Promise<RegistroCoexGravado> {
    const tipo = tipoDe(tipoBruto);
    const c = s.porta;
    const [modo, versoes] = await Promise.all([
      this.modo(c.rede, c.hospital),
      this.porta.versoesRegistro(c, tipo),
    ]);
    const v = modo === 'tela' ? versoes[0] : undefined;
    const vale = v?.conteudo ?? null;
    return {
      tipo,
      modo,
      fonte: vale ? 'tela' : 'arquivo',
      versaoVigente: vale && v ? v.versao : null,
      conteudo: vale,
      historico: versoes.map((x) => ({
        versao: x.versao,
        motivo: x.motivo,
        gravadoPor: x.gravadoPor,
        gravadoEm: x.gravadoEm,
        retornoAoArquivo: x.conteudo === null,
      })),
    };
  }

  /** Grava a versão nova (a senha é conferida antes, pelo controlador). */
  async gravar(s: SessaoCadastro, tipoBruto: string, corpo: unknown): Promise<RegistroCoexGravado> {
    const tipo = tipoDe(tipoBruto);
    const c = s.porta;
    const p = esquemaGravarRegistroCoex.safeParse(corpo);
    if (!p.success) throw invalido(p.error.issues[0]?.message ?? 'Informe o registro e o motivo.');
    if ((await this.modo(c.rede, c.hospital)) !== 'tela')
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Registro só pelo registro versionado',
        'Neste estabelecimento o registro do fim e da retrocompatibilidade muda só pelo registro versionado (exceção registrada, D-RETRO-REGISTRO-F6). Para gravar pela tela, ajuste o parâmetro "coexistencia.registro.modo".',
        { codigo: 'registro-por-versionado' },
      );
    let conteudo: Record<string, unknown> | null = null;
    if (p.data.conteudo !== null) {
      const r = esquemaDo(tipo).safeParse(p.data.conteudo);
      if (!r.success) throw invalido(`Registro fora do esquema: ${r.error.issues[0]?.message ?? 'inválido'}`);
      if (r.data.estabelecimento !== c.hospital) throw invalido('O registro é de outro estabelecimento.');
      conteudo = r.data as Record<string, unknown>;
      if (jsonAscii(conteudo).length > TETO_REGISTRO_COEX)
        throw invalido('O registro passa do tamanho permitido.');
    } else {
      const [v] = await this.porta.versoesRegistro(c, tipo);
      if (!v || v.conteudo === null)
        throw new ErroProblema(
          'recusa-de-negocio',
          409,
          'Já vale o registro versionado',
          'Não há registro gravado pela tela em vigor: não há o que voltar.',
          { codigo: 'registro-ja-no-arquivo' },
        );
    }
    const motivo = p.data.motivo;
    await this.porta.gravarSgh(
      c,
      (versao: number) =>
        linhaTrilha(
          s,
          EVENTOS_AUDITAVEIS.coexistenciaRegistroGravado.codigo,
          'config.coexistencia',
          `registro:${tipo}:${conteudo === null ? 'arquivo' : 'gravado'}`.slice(0, 80),
          {
            tabela: 'SGH_CFG_COEX_REGISTRO',
            id: null,
            chave: `${c.hospital}:${tipo}:${versao}`.slice(0, 120),
          },
        ),
      (g) => g.gravarVersaoRegistro(tipo, conteudo, motivo, s.login),
    );
    return this.ler(s, tipo);
  }
}
