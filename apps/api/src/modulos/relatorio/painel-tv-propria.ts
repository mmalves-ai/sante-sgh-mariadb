// Porta PRÓPRIA dos painéis de TV operacionais (01-REL L116; F3), sobre o banco do cliente. As regras são do
// @sgh/dominio-relatorio (painel-tv.ts); aqui ficam as leituras e as gravações:
//   - o CATÁLOGO do cadastro: tipos de painel, unidades de terapia intensiva, salas cirúrgicas e televisores
//     (estacao_trabalho);
//   - o CADASTRO do painel (painel_tv): criar em rascunho, salvar dados e blocos de uma vez (painel_tv_bloco, um por
//     sequência; o bloco que sai fica marcado como excluído e volta se for posto de novo) e mudar a situação (ativar
//     exige bloco). Trava pela versão lida;
//   - os TELEVISORES (painel_tv_dispositivo): ligar um televisor ao painel gera o código de pareamento; a TV digita o
//     código uma vez, dentro da validade (parear: o código é anulado e o aparelho recebe um segredo, do qual o banco
//     guarda só o resumo SHA-256); a TV lê a tela e avisa que está no ar (contato) apresentando o segredo; desligar
//     anula o resumo (a TV desligada é recusada e volta ao pareamento) e não apaga;
//   - a TELA da TV: os blocos ativos com as linhas da fonte de cada um, lidas na hora do banco do cliente: ocupação da
//     terapia intensiva (ocupacao_leito), fila da farmácia (dispensacao), mapa cirúrgico do dia (agendamento_cirurgico)
//     e laboratório (requisicao_exame). Nenhum nome de paciente: só iniciais, número do pedido e tempos (LGPD).
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  atrasoMinutos,
  type BlocoTvEntrada,
  conferirAtivacaoTv,
  conferirBlocosTv,
  conferirTemposTv,
  diasDePermanencia,
  dispositivoNoAr,
  type ErroRegraTv,
  estadoCirurgiaTv,
  estadoPrazoTv,
  expiracaoPareamento,
  FONTES_BLOCO_TV,
  type FonteBlocoTv,
  FORMAS_BLOCO_TV,
  gerarCodigoPareamento,
  iniciaisDoNome,
  LIMITE_LINHAS_TV,
  MAXIMO_BLOCOS_TV,
  minutosDesde,
  normalizarCodigoPareamento,
  pareamentoVigente,
  resumoOcupacaoTv,
  SITUACOES_PAINEL_TV,
} from '@sgh/dominio-relatorio';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  BaseComunicacaoPropria,
  bool,
  conflito,
  type ContextoComunicacao,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  txtOuNull,
} from '../integracao/comunicacao-base-propria.js';

export const PORTA_PAINEL_TV = Symbol('PORTA_PAINEL_TV');

const T_PAINEL = 'painel_tv';
const T_BLOCO = 'painel_tv_bloco';
const T_DISPOSITIVO = 'painel_tv_dispositivo';
export const TABELAS_PAINEL_TV = [T_PAINEL, T_BLOCO, T_DISPOSITIVO] as const;

export const OPERACOES_PAINEL_TV = {
  criar: 'relatorio.painel_tv.criar',
  salvar: 'relatorio.painel_tv.salvar',
  situacao: 'relatorio.painel_tv.situacao',
  ligar: 'relatorio.painel_tv.dispositivo.ligar',
  desligar: 'relatorio.painel_tv.dispositivo.desligar',
  parear: 'relatorio.painel_tv.dispositivo.parear',
  contato: 'relatorio.painel_tv.dispositivo.contato',
} as const;

function recusaTv(erros: readonly ErroRegraTv[], titulo: string): ErroOperacao {
  return new ErroOperacao(422, erros[0]!.codigo, titulo, erros.map((e) => e.mensagem).join(' '), {
    campos: erros.map((e) => e.campo),
    regras: erros.map((e) => ({ codigo: e.codigo, mensagem: e.mensagem })),
  });
}

const tempo = z.number().int();
const dadosPainel = {
  nome: z.string().trim().min(3).max(150),
  tempoRotacaoSegundos: tempo,
  atualizacaoSegundos: tempo,
};
export const esquemaCriarPainelTv = z
  .object({
    codigo: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_.-]{2,30}$/),
    tipoId: z.number().int().positive(),
    ...dadosPainel,
  })
  .strict();
const esquemaBloco = z
  .object({
    fonte: z.enum(FONTES_BLOCO_TV),
    titulo: z.string().trim().max(150),
    forma: z.enum(FORMAS_BLOCO_TV),
    tempoEmTelaSegundos: z.number().int().nullable(),
    unidadeInternacaoId: z.number().int().positive().nullable(),
    salaCirurgicaId: z.number().int().positive().nullable(),
    limite: z.number().int(),
  })
  .strict();
export const esquemaSalvarPainelTv = z
  .object({
    versao: z.number().int().positive(),
    ...dadosPainel,
    blocos: z.array(esquemaBloco).max(MAXIMO_BLOCOS_TV + 1),
  })
  .strict();
export const esquemaSituacaoPainelTv = z
  .object({ versao: z.number().int().positive(), situacao: z.enum(SITUACOES_PAINEL_TV) })
  .strict();
export const esquemaLigarDispositivo = z.object({ estacaoId: z.number().int().positive() }).strict();
export const esquemaParear = z
  .object({ codigo: z.string().max(20), versaoCliente: z.string().trim().max(30).nullable() })
  .strict();

interface FiltroBloco {
  fonte: FonteBlocoTv;
  unidadeInternacaoId: number | null;
  salaCirurgicaId: number | null;
  limite: number;
}

function lerFiltro(v: unknown): FiltroBloco {
  const o = (typeof v === 'string' ? JSON.parse(v) : (v ?? {})) as Partial<FiltroBloco>;
  return {
    fonte: (FONTES_BLOCO_TV as readonly string[]).includes(String(o.fonte)) ? o.fonte! : 'uti',
    unidadeInternacaoId: o.unidadeInternacaoId ?? null,
    salaCirurgicaId: o.salaCirurgicaId ?? null,
    limite: Number(o.limite ?? 20),
  };
}

/** Resumo SHA-256 (hex) do segredo do aparelho: o segredo em si só existe na TV. */
const resumoSegredo = (segredo: string): string => createHash('sha256').update(segredo, 'utf8').digest('hex');

/** Confere o segredo apresentado pela TV contra o resumo gravado, em tempo constante. */
function segredoConfere(segredo: string | null | undefined, resumo: unknown): boolean {
  if (!segredo || typeof resumo !== 'string' || resumo.length !== 64) return false;
  const a = Buffer.from(resumoSegredo(segredo), 'hex');
  const b = Buffer.from(resumo, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

const data = (v: unknown): Date | null =>
  v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v).replace(' ', 'T'));

const SQL_PAINEL = `SELECT p.id, p.codigo, p.nome, p.situacao, p.tempo_rotacao_segundos, p.atualizacao_segundos, p.versao,
    t.id AS tipo_id, t.codigo AS tipo_codigo, t.descricao AS tipo_descricao, t.categoria
  FROM painel_tv p JOIN tipo_painel_tv t ON t.id = p.tipo_painel_tv_id
  WHERE p.id = ? AND p.estabelecimento_id = ? AND p.excluido_em IS NULL`;
const SQL_BLOCOS = `SELECT id, sequencia, titulo, forma_exibicao, filtro, tempo_em_tela_segundos, ativo
  FROM painel_tv_bloco WHERE painel_tv_id = ? AND excluido_em IS NULL ORDER BY sequencia`;
const SQL_DISPOSITIVOS = `SELECT d.id, d.estacao_trabalho_id, e.nome AS estacao_nome, d.codigo_pareamento,
    d.codigo_expira_em, d.pareado_em,
    d.ultimo_contato_em, d.versao_cliente, d.versao
  FROM painel_tv_dispositivo d JOIN estacao_trabalho e ON e.id = d.estacao_trabalho_id
  WHERE d.painel_tv_id = ? AND d.excluido_em IS NULL AND d.ativo = TRUE ORDER BY e.nome`;
const SQL_UNIDADES_INTENSIVAS = `SELECT id, descricao FROM unidade_internacao
  WHERE estabelecimento_id = ? AND excluido_em IS NULL AND ativo = TRUE
    AND (intensiva = TRUE OR tipo IN ('uti_adulto','uti_pediatrica','uti_neonatal'))
  ORDER BY descricao`;

export class PortaPainelTvPropria extends BaseComunicacaoPropria {
  async catalogo(c: ContextoComunicacao) {
    return this.ler(c, 'painel_tv.catalogo', async (l, est) => ({
      tipos: (
        await l.consultar(
          `SELECT id, codigo, descricao, categoria, atualizacao_padrao_segundos FROM tipo_painel_tv
            WHERE ativo = TRUE AND categoria <> 'chamada' ORDER BY descricao`,
        )
      ).map((r) => ({
        id: num(r['id']),
        codigo: String(r['codigo']),
        descricao: String(r['descricao']),
        categoria: String(r['categoria']),
        atualizacaoPadraoSegundos: num(r['atualizacao_padrao_segundos']),
      })),
      unidadesIntensivas: (await l.consultar(SQL_UNIDADES_INTENSIVAS, [est])).map((r) => ({
        id: num(r['id']),
        nome: String(r['descricao']),
      })),
      salas: (
        await l.consultar(
          `SELECT id, descricao FROM sala_cirurgica WHERE estabelecimento_id = ? AND excluido_em IS NULL
              AND situacao <> 'inativa' ORDER BY descricao`,
          [est],
        )
      ).map((r) => ({ id: num(r['id']), nome: String(r['descricao']) })),
      televisores: (
        await l.consultar(
          `SELECT id, codigo, nome FROM estacao_trabalho WHERE estabelecimento_id = ? AND excluido_em IS NULL
              AND ativo = TRUE ORDER BY nome LIMIT 500`,
          [est],
        )
      ).map((r) => ({ id: num(r['id']), codigo: String(r['codigo']), nome: String(r['nome']) })),
    }));
  }

  async paineis(c: ContextoComunicacao) {
    return this.ler(c, 'painel_tv.paineis', async (l, est) => {
      const [ag] = await l.consultar('SELECT NOW(3) AS agora');
      const agora = data(ag?.['agora'])!;
      const ls = await l.consultar(
        `SELECT p.id, p.codigo, p.nome, p.situacao, p.atualizacao_segundos, p.versao, t.descricao AS tipo,
            (SELECT COUNT(*) FROM painel_tv_bloco b WHERE b.painel_tv_id = p.id AND b.excluido_em IS NULL AND b.ativo = TRUE) AS blocos,
            (SELECT COUNT(*) FROM painel_tv_dispositivo d WHERE d.painel_tv_id = p.id AND d.excluido_em IS NULL AND d.ativo = TRUE) AS televisores,
            (SELECT MAX(d.ultimo_contato_em) FROM painel_tv_dispositivo d WHERE d.painel_tv_id = p.id AND d.excluido_em IS NULL AND d.ativo = TRUE) AS ultimo_contato
          FROM painel_tv p JOIN tipo_painel_tv t ON t.id = p.tipo_painel_tv_id
          WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL ORDER BY p.ordem, p.nome LIMIT 500`,
        [est],
      );
      return ls.map((r) => ({
        id: num(r['id']),
        codigo: String(r['codigo']),
        nome: String(r['nome']),
        tipo: String(r['tipo']),
        situacao: String(r['situacao']),
        blocos: num(r['blocos']),
        televisores: num(r['televisores']),
        noAr: dispositivoNoAr(data(r['ultimo_contato']), agora, num(r['atualizacao_segundos'])),
        versao: num(r['versao']),
      }));
    });
  }

  async detalhe(c: ContextoComunicacao, id: number) {
    return this.ler(c, 'painel_tv.detalhe', (l, est) => this.lerDetalhe(l, est, id));
  }

  private async lerDetalhe(l: Leitor, est: number, id: number) {
    const [p] = await l.consultar(SQL_PAINEL, [id, est]);
    if (!p) throw naoEncontrado('Painel de TV');
    const [ag] = await l.consultar('SELECT NOW(3) AS agora');
    const agora = data(ag?.['agora'])!;
    const atualizacao = num(p['atualizacao_segundos']);
    return {
      id,
      codigo: String(p['codigo']),
      nome: String(p['nome']),
      situacao: String(p['situacao']),
      tipo: {
        id: num(p['tipo_id']),
        codigo: String(p['tipo_codigo']),
        descricao: String(p['tipo_descricao']),
      },
      tempoRotacaoSegundos: num(p['tempo_rotacao_segundos']),
      atualizacaoSegundos: atualizacao,
      versao: num(p['versao']),
      blocos: (await l.consultar(SQL_BLOCOS, [id]))
        .filter((b) => bool(b['ativo']))
        .map((b) => {
          const f = lerFiltro(b['filtro']);
          return {
            fonte: f.fonte,
            titulo: String(b['titulo']),
            forma: String(b['forma_exibicao']) as BlocoTvEntrada['forma'],
            tempoEmTelaSegundos: numOuNull(b['tempo_em_tela_segundos']),
            unidadeInternacaoId: f.unidadeInternacaoId,
            salaCirurgicaId: f.salaCirurgicaId,
            limite: f.limite,
          };
        }),
      televisores: (await l.consultar(SQL_DISPOSITIVOS, [id])).map((d) => ({
        id: num(d['id']),
        estacaoId: num(d['estacao_trabalho_id']),
        estacao: String(d['estacao_nome']),
        codigoPareamento: pareamentoVigente(data(d['codigo_expira_em']), agora)
          ? txtOuNull(d['codigo_pareamento'])
          : null,
        codigoExpiraEm: data(d['codigo_expira_em'])?.toISOString() ?? null,
        pareado: d['pareado_em'] !== null,
        ultimoContatoEm: data(d['ultimo_contato_em'])?.toISOString() ?? null,
        noAr: dispositivoNoAr(data(d['ultimo_contato_em']), agora, atualizacao),
        versaoCliente: txtOuNull(d['versao_cliente']),
      })),
    };
  }

  async criar(c: ContextoComunicacao, entrada: unknown): Promise<{ id: number; versao: number }> {
    const e = entradaValida(esquemaCriarPainelTv, entrada);
    const erros = conferirTemposTv(e.tempoRotacaoSegundos, e.atualizacaoSegundos);
    if (erros.length > 0) throw recusaTv(erros, 'Tempos inválidos');
    return this.gravar(c, OPERACOES_PAINEL_TV.criar, TABELAS_PAINEL_TV, async (tx, est) => {
      const [t] = await tx.consultar(
        `SELECT id FROM tipo_painel_tv WHERE id = ? AND ativo = TRUE AND categoria <> 'chamada'`,
        [e.tipoId],
        { teto: 1 },
      );
      if (!t) throw naoEncontrado('Tipo de painel de TV');
      const [r] = await tx.consultar(
        'SELECT id FROM painel_tv WHERE estabelecimento_id = ? AND codigo = ? LIMIT 1',
        [est, e.codigo],
        { teto: 1 },
      );
      if (r)
        throw recusaTv(
          [
            {
              campo: 'codigo',
              codigo: 'codigo-repetido',
              mensagem: 'Já existe um painel de TV com este código.',
            },
          ],
          'Código repetido',
        );
      const id = await tx.incluir(T_PAINEL, {
        estabelecimento_id: est,
        tipo_painel_tv_id: e.tipoId,
        codigo: e.codigo,
        nome: e.nome,
        tempo_rotacao_segundos: e.tempoRotacaoSegundos,
        atualizacao_segundos: e.atualizacaoSegundos,
        alterna_blocos: true,
        situacao: 'rascunho',
        origem: 'sistema',
      });
      return { id, versao: 1 };
    });
  }

  async salvar(
    c: ContextoComunicacao,
    id: number,
    entrada: unknown,
  ): Promise<{ id: number; versao: number }> {
    const e = entradaValida(esquemaSalvarPainelTv, entrada);
    const blocos: BlocoTvEntrada[] = e.blocos;
    const erros = [
      ...conferirTemposTv(e.tempoRotacaoSegundos, e.atualizacaoSegundos),
      ...conferirBlocosTv(blocos),
    ];
    if (erros.length > 0) throw recusaTv(erros, 'Painel de TV com regra violada');
    return this.gravar(c, OPERACOES_PAINEL_TV.salvar, TABELAS_PAINEL_TV, async (tx, est, usuario) => {
      const p = await this.travar(tx, est, id);
      if (num(p['versao']) !== e.versao) throw conflito();
      await this.conferirFiltros(tx, est, blocos);
      if (p['situacao'] === 'ativo' && blocos.length === 0)
        throw recusaTv(conferirAtivacaoTv(0), 'Painel ativo sem bloco');
      const agora = new Date();
      const existentes = await tx.consultar(
        'SELECT id, sequencia, versao, excluido_em FROM painel_tv_bloco WHERE painel_tv_id = ?',
        [id],
        { teto: 500 },
      );
      const porSeq = new Map(existentes.map((r) => [num(r['sequencia']), r]));
      for (const [i, b] of blocos.entries()) {
        const seq = i + 1;
        const valores = {
          titulo: b.titulo.trim(),
          forma_exibicao: b.forma,
          tempo_em_tela_segundos: b.tempoEmTelaSegundos,
          filtro: JSON.stringify({
            fonte: b.fonte,
            unidadeInternacaoId: b.unidadeInternacaoId,
            salaCirurgicaId: b.salaCirurgicaId,
            limite: b.limite,
          }),
          ativo: true,
        };
        const r = porSeq.get(seq);
        if (r)
          await tx.alterar(T_BLOCO, num(r['id']), num(r['versao']), {
            ...valores,
            excluido_em: null,
            excluido_por: null,
          });
        else await tx.incluir(T_BLOCO, { painel_tv_id: id, sequencia: seq, origem: 'sistema', ...valores });
      }
      for (const [seq, r] of porSeq)
        if (seq > blocos.length && r['excluido_em'] === null)
          await tx.alterar(T_BLOCO, num(r['id']), num(r['versao']), {
            ativo: false,
            excluido_em: agora,
            excluido_por: usuario,
          });
      const versao = await tx.alterar(T_PAINEL, id, e.versao, {
        nome: e.nome,
        tempo_rotacao_segundos: e.tempoRotacaoSegundos,
        atualizacao_segundos: e.atualizacaoSegundos,
      });
      return { id, versao };
    });
  }

  async mudarSituacao(
    c: ContextoComunicacao,
    id: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: string; versao: number }> {
    const e = entradaValida(esquemaSituacaoPainelTv, entrada);
    return this.gravar(c, OPERACOES_PAINEL_TV.situacao, TABELAS_PAINEL_TV, async (tx, est) => {
      const p = await this.travar(tx, est, id);
      if (num(p['versao']) !== e.versao) throw conflito();
      if (e.situacao === 'ativo') {
        const [q] = await tx.consultar(
          'SELECT COUNT(*) AS n FROM painel_tv_bloco WHERE painel_tv_id = ? AND excluido_em IS NULL AND ativo = TRUE',
          [id],
          { teto: 1 },
        );
        const erros = conferirAtivacaoTv(num(q?.['n']));
        if (erros.length > 0) throw recusaTv(erros, 'Painel sem bloco');
      }
      const versao = await tx.alterar(T_PAINEL, id, e.versao, { situacao: e.situacao });
      return { id, situacao: e.situacao, versao };
    });
  }

  /** Liga um televisor ao painel e gera o código de pareamento (religar um desligado gera código novo). */
  async ligarDispositivo(
    c: ContextoComunicacao,
    painelId: number,
    entrada: unknown,
  ): Promise<{ id: number; codigoPareamento: string; codigoExpiraEm: string }> {
    const e = entradaValida(esquemaLigarDispositivo, entrada);
    return this.gravar(c, OPERACOES_PAINEL_TV.ligar, TABELAS_PAINEL_TV, async (tx, est) => {
      await this.travar(tx, est, painelId);
      const [s] = await tx.consultar(
        'SELECT id FROM estacao_trabalho WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND ativo = TRUE',
        [e.estacaoId, est],
        { teto: 1 },
      );
      if (!s) throw naoEncontrado('Televisor');
      const codigo = await this.codigoLivre(tx);
      const [d] = await tx.consultar(
        'SELECT id, versao, ativo, excluido_em FROM painel_tv_dispositivo WHERE painel_tv_id = ? AND estacao_trabalho_id = ?',
        [painelId, e.estacaoId],
        { teto: 1 },
      );
      if (d && bool(d['ativo']) && d['excluido_em'] === null)
        throw recusaTv(
          [
            {
              campo: 'estacaoId',
              codigo: 'televisor-ja-ligado',
              mensagem: 'Este televisor já está ligado ao painel.',
            },
          ],
          'Televisor já ligado',
        );
      const expira = expiracaoPareamento(new Date());
      const valores = {
        codigo_pareamento: codigo,
        codigo_expira_em: expira,
        pareado_em: null,
        segredo_resumo: null,
        ultimo_contato_em: null,
        endereco_ip: null,
        versao_cliente: null,
        ativo: true,
      };
      const id = d
        ? (await tx.alterar(T_DISPOSITIVO, num(d['id']), num(d['versao']), {
            ...valores,
            excluido_em: null,
            excluido_por: null,
          }),
          num(d['id']))
        : await tx.incluir(T_DISPOSITIVO, {
            painel_tv_id: painelId,
            estacao_trabalho_id: e.estacaoId,
            ...valores,
          });
      return { id, codigoPareamento: codigo, codigoExpiraEm: expira.toISOString() };
    });
  }

  async desligarDispositivo(c: ContextoComunicacao, painelId: number, dispositivoId: number) {
    return this.gravar(c, OPERACOES_PAINEL_TV.desligar, TABELAS_PAINEL_TV, async (tx, est, usuario) => {
      await this.travar(tx, est, painelId);
      const [d] = await tx.consultar(
        'SELECT id, versao FROM painel_tv_dispositivo WHERE id = ? AND painel_tv_id = ? AND excluido_em IS NULL',
        [dispositivoId, painelId],
        { teto: 1 },
      );
      if (!d) throw naoEncontrado('Televisor do painel');
      await tx.alterar(T_DISPOSITIVO, dispositivoId, num(d['versao']), {
        ativo: false,
        codigo_pareamento: null,
        codigo_expira_em: null,
        segredo_resumo: null,
        excluido_em: new Date(),
        excluido_por: usuario,
      });
      return { id: dispositivoId };
    });
  }

  /**
   * A TV digita o código uma vez, dentro da validade: o código é anulado e o aparelho recebe o segredo que o prende ao
   * televisor (devolvido só aqui; o banco guarda o resumo).
   */
  async parear(
    c: ContextoComunicacao,
    entrada: unknown,
    ip: string | null,
  ): Promise<{ id: number; painelId: number; segredo: string }> {
    const e = entradaValida(esquemaParear, entrada);
    const codigo = normalizarCodigoPareamento(e.codigo);
    const invalido = () =>
      recusaTv(
        [
          {
            campo: 'codigo',
            codigo: 'codigo-invalido',
            mensagem: 'Código de pareamento inválido, vencido ou já usado.',
          },
        ],
        'Código inválido',
      );
    if (!codigo) throw invalido();
    return this.gravar(c, OPERACOES_PAINEL_TV.parear, TABELAS_PAINEL_TV, async (tx, est) => {
      const [d] = await tx.consultarParaAtualizar(
        `SELECT d.id, d.painel_tv_id, d.codigo_expira_em, d.versao
          FROM painel_tv_dispositivo d JOIN painel_tv p ON p.id = d.painel_tv_id
          WHERE d.codigo_pareamento = ? AND d.ativo = TRUE AND d.excluido_em IS NULL AND p.estabelecimento_id = ?
            AND p.excluido_em IS NULL`,
        [codigo, est],
        { teto: 1 },
      );
      const agora = new Date();
      if (!d || !pareamentoVigente(data(d['codigo_expira_em']), agora)) throw invalido();
      const segredo = randomBytes(32).toString('base64url');
      await tx.alterar(T_DISPOSITIVO, num(d['id']), num(d['versao']), {
        codigo_pareamento: null,
        codigo_expira_em: null,
        segredo_resumo: resumoSegredo(segredo),
        pareado_em: agora,
        ultimo_contato_em: agora,
        endereco_ip: ip ? ip.slice(0, 45) : null,
        versao_cliente: e.versaoCliente,
      });
      return { id: num(d['id']), painelId: num(d['painel_tv_id']), segredo };
    });
  }

  /** A TV pareada avisa que está no ar (a cada poucos minutos), apresentando o segredo do aparelho. */
  async contato(c: ContextoComunicacao, dispositivoId: number, segredo: string | null, ip: string | null) {
    return this.gravar(c, OPERACOES_PAINEL_TV.contato, TABELAS_PAINEL_TV, async (tx, est) => {
      const [d] = await tx.consultar(
        `SELECT d.id, d.segredo_resumo, d.versao FROM painel_tv_dispositivo d JOIN painel_tv p ON p.id = d.painel_tv_id
          WHERE d.id = ? AND d.ativo = TRUE AND d.excluido_em IS NULL AND d.pareado_em IS NOT NULL
            AND p.estabelecimento_id = ?`,
        [dispositivoId, est],
        { teto: 1 },
      );
      if (!d || !segredoConfere(segredo, d['segredo_resumo'])) throw naoEncontrado('Televisor pareado');
      await tx.alterar(T_DISPOSITIVO, dispositivoId, num(d['versao']), {
        ultimo_contato_em: new Date(),
        endereco_ip: ip ? ip.slice(0, 45) : null,
      });
      return { id: dispositivoId };
    });
  }

  /** Prévia do cadastro: o que a TV do painel mostra (rota de quem edita o painel). */
  async tela(c: ContextoComunicacao, id: number) {
    return this.ler(c, 'painel_tv.tela', (l, est) => this.montarTela(l, est, id));
  }

  /**
   * A tela pelo televisor: só o aparelho que apresenta o segredo de um televisor ativo e pareado lê o painel dele.
   * Televisor desligado, de outro estabelecimento ou segredo errado: recusado (404), e a TV volta ao pareamento.
   */
  async telaDoTelevisor(c: ContextoComunicacao, dispositivoId: number, segredo: string | null) {
    return this.ler(c, 'painel_tv.tela_televisor', async (l, est) => {
      const [d] = await l.consultar(
        `SELECT d.painel_tv_id, d.segredo_resumo FROM painel_tv_dispositivo d JOIN painel_tv p ON p.id = d.painel_tv_id
          WHERE d.id = ? AND d.ativo = TRUE AND d.excluido_em IS NULL AND d.pareado_em IS NOT NULL
            AND p.estabelecimento_id = ? AND p.excluido_em IS NULL`,
        [dispositivoId, est],
      );
      if (!d || !segredoConfere(segredo, d['segredo_resumo'])) throw naoEncontrado('Televisor pareado');
      return { ...(await this.montarTela(l, est, num(d['painel_tv_id']))), televisorId: dispositivoId };
    });
  }

  private async montarTela(l: Leitor, est: number, id: number) {
    const [p] = await l.consultar(SQL_PAINEL, [id, est]);
    if (!p) throw naoEncontrado('Painel de TV');
    const [ag] = await l.consultar('SELECT NOW(3) AS agora');
    const agora = data(ag?.['agora'])!;
    const ativo = p['situacao'] === 'ativo';
    const blocos = ativo ? (await l.consultar(SQL_BLOCOS, [id])).filter((b) => bool(b['ativo'])) : [];
    const saida = [];
    for (const b of blocos) {
      const f = lerFiltro(b['filtro']);
      const limite = Math.min(Math.max(1, f.limite), LIMITE_LINHAS_TV);
      saida.push({
        sequencia: num(b['sequencia']),
        titulo: String(b['titulo']),
        fonte: f.fonte,
        forma: String(b['forma_exibicao']),
        tempoEmTelaSegundos: numOuNull(b['tempo_em_tela_segundos']) ?? num(p['tempo_rotacao_segundos']),
        ...(await this.lerFonte(l, est, f, limite, agora)),
      });
    }
    return {
      id,
      nome: String(p['nome']),
      situacao: String(p['situacao']),
      atualizacaoSegundos: num(p['atualizacao_segundos']),
      atualizadoEm: agora.toISOString(),
      blocos: saida,
    };
  }

  private async lerFonte(l: Leitor, est: number, f: FiltroBloco, limite: number, agora: Date) {
    type Linha = Record<string, string | number | null>;
    if (f.fonte === 'uti') {
      const ls = await l.consultar(
        `SELECT l.codigo AS leito, u.descricao AS unidade, i.data_hora_entrada,
            CASE WHEN pf.usa_nome_social = TRUE AND pf.nome_social IS NOT NULL THEN pf.nome_social ELSE pf.nome END AS nome
          FROM leito_hospitalar l
          JOIN unidade_internacao u ON u.id = l.unidade_internacao_id
          LEFT JOIN ocupacao_leito o ON o.leito_hospitalar_id = l.id AND o.situacao = 'ativa' AND o.data_hora_fim IS NULL
               AND o.excluido_em IS NULL
          LEFT JOIN internacao i ON i.id = o.internacao_id AND i.excluido_em IS NULL
          LEFT JOIN paciente pa ON pa.id = i.paciente_id
          LEFT JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
          WHERE l.estabelecimento_id = ? AND l.ativo = TRUE AND l.excluido_em IS NULL AND u.excluido_em IS NULL
            AND (u.intensiva = TRUE OR u.tipo IN ('uti_adulto','uti_pediatrica','uti_neonatal'))
            AND (? IS NULL OR u.id = ?)
          ORDER BY u.descricao, l.ordem_exibicao, l.codigo LIMIT 400`,
        [est, f.unidadeInternacaoId, f.unidadeInternacaoId],
      );
      const ocupados = ls.filter((r) => r['data_hora_entrada'] !== null).length;
      const r = resumoOcupacaoTv(ls.length, ocupados);
      return {
        colunas: [
          { campo: 'leito', rotulo: 'Leito' },
          { campo: 'unidade', rotulo: 'Unidade' },
          { campo: 'paciente', rotulo: 'Paciente' },
          { campo: 'dias', rotulo: 'Dias' },
        ],
        linhas: ls.slice(0, limite).map((x): Linha => ({
          leito: String(x['leito']),
          unidade: String(x['unidade']),
          paciente: x['data_hora_entrada'] !== null ? iniciaisDoNome(txtOuNull(x['nome'])) : 'Livre',
          dias:
            x['data_hora_entrada'] !== null ? diasDePermanencia(data(x['data_hora_entrada'])!, agora) : null,
          estado: x['data_hora_entrada'] !== null ? 'ocupado' : 'livre',
        })),
        resumo: [
          { rotulo: 'Leitos', valor: r.leitos },
          { rotulo: 'Ocupados', valor: r.ocupados },
          { rotulo: 'Livres', valor: r.livres },
          { rotulo: 'Ocupação (%)', valor: r.taxa ?? 0 },
        ],
      };
    }
    if (f.fonte === 'farmacia') {
      const ls = await l.consultar(
        `SELECT d.numero, d.tipo, d.situacao, d.criado_em, u.descricao AS unidade,
            CASE WHEN pf.usa_nome_social = TRUE AND pf.nome_social IS NOT NULL THEN pf.nome_social ELSE pf.nome END AS nome,
            (SELECT COUNT(*) FROM dispensacao_item di WHERE di.dispensacao_id = d.id AND di.excluido_em IS NULL
                AND di.situacao = 'pendente') AS pendentes
          FROM dispensacao d
          LEFT JOIN unidade_internacao u ON u.id = d.unidade_internacao_id
          LEFT JOIN paciente pa ON pa.id = d.paciente_id
          LEFT JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
          WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL AND d.situacao IN ('aberta','separada')
          ORDER BY d.criado_em LIMIT 400`,
        [est],
      );
      const espera = ls.map((x) => minutosDesde(data(x['criado_em'])!, agora));
      return {
        colunas: [
          { campo: 'numero', rotulo: 'Número' },
          { campo: 'paciente', rotulo: 'Paciente' },
          { campo: 'unidade', rotulo: 'Unidade' },
          { campo: 'situacao', rotulo: 'Situação' },
          { campo: 'itens', rotulo: 'Itens pendentes' },
          { campo: 'espera', rotulo: 'Espera (min)' },
        ],
        linhas: ls.slice(0, limite).map((x, i): Linha => ({
          numero: String(x['numero']),
          paciente: iniciaisDoNome(txtOuNull(x['nome'])),
          unidade: txtOuNull(x['unidade']) ?? '—',
          situacao: x['situacao'] === 'separada' ? 'Separada' : 'A separar',
          itens: num(x['pendentes']),
          espera: espera[i]!,
        })),
        resumo: [
          { rotulo: 'A separar', valor: ls.filter((x) => x['situacao'] === 'aberta').length },
          { rotulo: 'Separadas', valor: ls.filter((x) => x['situacao'] === 'separada').length },
          { rotulo: 'Maior espera (min)', valor: espera.length ? Math.max(...espera) : 0 },
        ],
      };
    }
    if (f.fonte === 'mapa_cirurgico') {
      const ls = await l.consultar(
        `SELECT a.numero, a.situacao, a.inicio_previsto_em, a.duracao_prevista_minutos, s.descricao AS sala,
            CASE WHEN pf.usa_nome_social = TRUE AND pf.nome_social IS NOT NULL THEN pf.nome_social ELSE pf.nome END AS nome
          FROM agendamento_cirurgico a
          JOIN sala_cirurgica s ON s.id = a.sala_cirurgica_id
          LEFT JOIN paciente pa ON pa.id = a.paciente_id
          LEFT JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
          WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL
            AND a.situacao IN ('agendado','confirmado','no_bloco','em_andamento','realizado')
            AND a.inicio_previsto_em >= CURDATE() AND a.inicio_previsto_em < CURDATE() + INTERVAL 1 DAY
            AND (? IS NULL OR s.id = ?)
          ORDER BY s.descricao, a.inicio_previsto_em LIMIT 400`,
        [est, f.salaCirurgicaId, f.salaCirurgicaId],
      );
      const ROTULO: Record<string, string> = {
        agendado: 'Agendada',
        confirmado: 'Confirmada',
        no_bloco: 'No bloco',
        em_andamento: 'Em sala',
        realizado: 'Realizada',
      };
      const hora = (d: Date) =>
        `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const atrasadas = ls.filter(
        (x) =>
          (x['situacao'] === 'agendado' || x['situacao'] === 'confirmado') &&
          atrasoMinutos(data(x['inicio_previsto_em']), agora) > 0,
      ).length;
      return {
        colunas: [
          { campo: 'sala', rotulo: 'Sala' },
          { campo: 'horario', rotulo: 'Horário' },
          { campo: 'paciente', rotulo: 'Paciente' },
          { campo: 'situacao', rotulo: 'Situação' },
          { campo: 'duracao', rotulo: 'Duração prevista (min)' },
        ],
        linhas: ls.slice(0, limite).map((x): Linha => ({
          sala: String(x['sala']),
          horario: hora(data(x['inicio_previsto_em'])!),
          paciente: iniciaisDoNome(txtOuNull(x['nome'])),
          situacao: ROTULO[String(x['situacao'])] ?? String(x['situacao']),
          duracao: numOuNull(x['duracao_prevista_minutos']),
          estado: estadoCirurgiaTv(
            String(x['situacao']),
            atrasoMinutos(data(x['inicio_previsto_em']), agora),
          ),
        })),
        resumo: [
          { rotulo: 'Cirurgias do dia', valor: ls.length },
          { rotulo: 'Em sala', valor: ls.filter((x) => x['situacao'] === 'em_andamento').length },
          { rotulo: 'Realizadas', valor: ls.filter((x) => x['situacao'] === 'realizado').length },
          { rotulo: 'Início atrasado', valor: atrasadas },
        ],
      };
    }
    const ls = await l.consultar(
      `SELECT r.numero, r.prioridade, r.situacao, r.solicitado_em, r.entrega_prevista_em,
          CASE WHEN pf.usa_nome_social = TRUE AND pf.nome_social IS NOT NULL THEN pf.nome_social ELSE pf.nome END AS nome
        FROM requisicao_exame r
        LEFT JOIN paciente pa ON pa.id = r.paciente_id
        LEFT JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
        WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL AND r.situacao IN ('solicitada','em_andamento')
        ORDER BY FIELD(r.prioridade, 'emergencia', 'urgente', 'rotina'), r.solicitado_em LIMIT 400`,
      [est],
    );
    const PRIORIDADE: Record<string, string> = {
      emergencia: 'Emergência',
      urgente: 'Urgente',
      rotina: 'Rotina',
    };
    const atraso = ls.map((x) => atrasoMinutos(data(x['entrega_prevista_em']), agora));
    return {
      colunas: [
        { campo: 'numero', rotulo: 'Pedido' },
        { campo: 'paciente', rotulo: 'Paciente' },
        { campo: 'prioridade', rotulo: 'Prioridade' },
        { campo: 'situacao', rotulo: 'Situação' },
        { campo: 'espera', rotulo: 'Espera (min)' },
        { campo: 'atraso', rotulo: 'Atraso (min)' },
      ],
      linhas: ls.slice(0, limite).map((x, i): Linha => ({
        numero: String(x['numero']),
        paciente: iniciaisDoNome(txtOuNull(x['nome'])),
        prioridade: PRIORIDADE[String(x['prioridade'])] ?? String(x['prioridade']),
        situacao: x['situacao'] === 'em_andamento' ? 'Em andamento' : 'Solicitada',
        espera: minutosDesde(data(x['solicitado_em'])!, agora),
        atraso: atraso[i]!,
        estado: estadoPrazoTv(atraso[i]!),
      })),
      resumo: [
        { rotulo: 'Em aberto', valor: ls.length },
        { rotulo: 'Urgentes e emergências', valor: ls.filter((x) => x['prioridade'] !== 'rotina').length },
        { rotulo: 'Atrasados', valor: atraso.filter((a) => a > 0).length },
      ],
    };
  }

  private async travar(tx: TxOperacao, est: number, id: number): Promise<Record<string, unknown>> {
    const [r] = await tx.consultarParaAtualizar(
      'SELECT id, situacao, versao FROM painel_tv WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [id, est],
      { teto: 1 },
    );
    if (!r) throw naoEncontrado('Painel de TV');
    return r;
  }

  private async conferirFiltros(
    tx: TxOperacao,
    est: number,
    blocos: readonly BlocoTvEntrada[],
  ): Promise<void> {
    const erros: ErroRegraTv[] = [];
    for (const [i, b] of blocos.entries()) {
      if (b.unidadeInternacaoId !== null) {
        const ok = await tx.consultar(
          `SELECT id FROM unidade_internacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
              AND ativo = TRUE AND (intensiva = TRUE OR tipo IN ('uti_adulto','uti_pediatrica','uti_neonatal'))`,
          [b.unidadeInternacaoId, est],
        );
        if (ok.length === 0)
          erros.push({
            campo: `blocos.${i}.unidadeInternacaoId`,
            codigo: 'unidade-nao-intensiva',
            mensagem: `Bloco ${i + 1}: a unidade não é de terapia intensiva deste estabelecimento.`,
          });
      }
      if (b.salaCirurgicaId !== null) {
        const ok = await tx.consultar(
          'SELECT id FROM sala_cirurgica WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [b.salaCirurgicaId, est],
        );
        if (ok.length === 0)
          erros.push({
            campo: `blocos.${i}.salaCirurgicaId`,
            codigo: 'sala-desconhecida',
            mensagem: `Bloco ${i + 1}: a sala não é deste estabelecimento.`,
          });
      }
    }
    if (erros.length > 0) throw recusaTv(erros, 'Filtro do bloco inválido');
  }

  private async codigoLivre(tx: TxOperacao): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const codigo = gerarCodigoPareamento((n) => randomInt(n));
      const [r] = await tx.consultar(
        'SELECT id FROM painel_tv_dispositivo WHERE codigo_pareamento = ?',
        [codigo],
        {
          teto: 1,
        },
      );
      if (!r) return codigo;
    }
    throw new ErroOperacao(
      503,
      'pareamento-indisponivel',
      'Tente de novo',
      'Não foi possível gerar o código agora.',
    );
  }
}
