// Integração do gravador próprio do cálculo da folha (família folha-executor) e da ficha do eSocial contra o MariaDB
// real (cliente de teste do lote, SGH_CLIENTE_TESTE): processamento com linhas, vigente com trava, troca de situação
// pela versão, período fechado, rescisão ligada ao desligamento e ao processamento, parâmetros das obrigações e ficha
// cifrada com versão. Massa sintética (massa.spec-util), apagada no fim. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type PapelLinhaFolha, TIPO_DO_PAPEL } from '@sgh/contratos';
import { ErroOperacao } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gravacaoDireta } from '../../enfermagem/gravacao-direta.js';
import type { TrilhaDaGravacao } from '../../exames/public-api.js';
import {
  CLIENTE_O3,
  encerrarMassaO3,
  type MassaPessoasO3,
  prepararMassaO3,
  SEM_BANCO_O3,
} from '../avaliacao/massa.spec-util.js';
import {
  gravarFichaEsocial,
  lerFichaEsocial,
  TABELA_FICHA_ESOCIAL,
} from '../esocial/ficha-esocial-propria.js';
import {
  type GravadorFolhaExecutor,
  gravadorFolhaExecutor,
  TABELAS_FOLHA_EXECUTOR,
} from './folha-executor-proprio.js';
import { PortaPessoasPropria } from '../porta-propria.js';
import { lerFerias, lerRescisoes } from './folha-porta-propria-calculo.js';
import type { LinhaCalculoDoVinculo } from './tipos-folha.js';

const MARCA = 'TF24FX';
const trilha: TrilhaDaGravacao = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'processamento_folha',
  entidadeId: null,
  dadosDepois: { evento: 'teste' },
  correlacao: 'teste-folha-executor',
};
const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema.codigo) : String(e);
  }
};
const totais = {
  colaboradores: 1,
  proventos: 3000,
  descontos: 270,
  liquido: 2730,
  inss: 270,
  irrf: 0,
  fgts: 240,
  inssPatronal: 600,
  rat: 30,
  terceiros: 174,
};
const papelDo = (tipo: string) =>
  (Object.entries(TIPO_DO_PAPEL).find(([, t]) => t === tipo)?.[0] ?? 'inss') as PapelLinhaFolha;

describe.skipIf(SEM_BANCO_O3)(`gravador próprio do cálculo da folha (cliente ${CLIENTE_O3})`, () => {
  let m: MassaPessoasO3;
  let exec: ReturnType<MassaPessoasO3['nucleo']['criarExecutor']>;
  const ctx = () => ({
    cliente: CLIENTE_O3,
    estabelecimento: m.est,
    usuario: m.usuario,
    correlacao: 'teste-folha-executor',
  });
  const gravar = <T>(fn: (g: GravadorFolhaExecutor) => Promise<T>) =>
    gravacaoDireta(exec, ctx(), {
      nome: 'pessoas.calculo_folha.gravar',
      tabelas: TABELAS_FOLHA_EXECUTOR,
      trilha,
      gravador: (tx, est) => gravadorFolhaExecutor(tx, est),
      fn,
    });
  let tipoRescisao = 0;

  async function limpar() {
    await m.nucleo.escrever({ cliente: CLIENTE_O3, correlacao: 'limpeza-folha-executor' }, async (e) => {
      await e.executar('DELETE FROM rescisao WHERE estabelecimento_id = ?', [m.est]);
      await e.executar('DELETE FROM desligamento WHERE estabelecimento_id = ?', [m.est]);
      await e.executar(
        'DELETE l FROM processamento_folha_linha l JOIN processamento_folha p ON p.id = l.processamento_folha_id WHERE p.estabelecimento_id = ?',
        [m.est],
      );
      await e.executar('DELETE FROM processamento_folha WHERE estabelecimento_id = ?', [m.est]);
      await e.executar('DELETE FROM fechamento_periodo_folha WHERE estabelecimento_id = ?', [m.est]);
      await e.executar('DELETE FROM parametro_obrigacao WHERE estabelecimento_id = ?', [m.est]);
      await e.executar(`DELETE FROM ${TABELA_FICHA_ESOCIAL} WHERE estabelecimento_id = ?`, [m.est]);
      await e.executar(
        "UPDATE vinculo_trabalho SET situacao = 'ativo', data_desligamento = NULL, tipo_rescisao_id = NULL WHERE id = ?",
        [m.vinculo],
      );
      await e.executar('DELETE FROM tipo_rescisao WHERE codigo = ?', [MARCA]);
      await e.executar(
        'DELETE c FROM codigo_esocial c JOIN tabela_esocial t ON t.id = c.tabela_esocial_id WHERE t.codigo_oficial = ?',
        [MARCA],
      );
      await e.executar('DELETE FROM tabela_esocial WHERE codigo_oficial = ?', [MARCA]);
    });
  }

  beforeAll(async () => {
    m = await prepararMassaO3('F24X');
    exec = m.nucleo.criarExecutor();
    await limpar();
  });
  afterAll(async () => {
    if (m) {
      await limpar();
      await encerrarMassaO3(m);
    }
  });

  it('processamento: grava com linhas, relê com trava e resumo, troca a situação pela versão', async () => {
    const competencia = '2098-07';
    const linhas: LinhaCalculoDoVinculo[] = (['provento', 'desconto', 'base'] as const).map((t, i) => ({
      vinculo: m.vinculo,
      papel: papelDo(t),
      tipo: t,
      rubrica: null,
      codigoRubrica: null,
      quantidade: i === 0 ? 30 : 0,
      unidade: i === 0 ? 'dias' : 'valor',
      valor: [3000, 270, 3000][i]!,
      memoria: `linha sintética ${i}`,
      centroCusto: 0,
      diasPagos: 30,
    }));
    const r = await gravar(async (g) => {
      const antes = await g.emVigorComTrava(m.est, competencia);
      const id = await g.incluirProcesso({
        empresa: m.est,
        competencia,
        numero: antes.proximoNumero,
        totais,
        foraDaFolha: 2,
        tabelaLegal: '2098-01-01',
        parametros: '',
        resumo: 'a'.repeat(64),
        por: m.login,
      });
      const q = await g.incluirLinhas(id, linhas);
      return {
        antes,
        id,
        q,
        vigente: await g.emVigorComTrava(m.est, competencia),
        resumo: await g.resumoVinculos(id),
      };
    });
    expect(r.antes).toEqual({ vigente: null, proximoNumero: 1 });
    expect(r.q).toBe(3);
    expect(r.vigente.proximoNumero).toBe(2);
    expect(r.vigente.vigente).toMatchObject({
      id: r.id,
      empresa: m.est,
      competencia,
      tipo: 'mensal',
      numero: 1,
      situacao: 'calculada',
      pagamento: null,
      totais,
      foraDaFolha: 2,
      tabelaLegal: '2098-01-01',
      parametros: '',
      calculadoPor: m.login,
      situacaoPor: null,
      motivo: null,
    });
    expect(r.resumo).toHaveLength(1);
    expect(r.resumo[0]).toMatchObject({ vinculo: m.vinculo, diasPagos: 30, proventos: 3000, descontos: 270 });

    // Repetir o número é concorrência; linha repetida não grava.
    expect(
      await codigo(
        gravar((g) =>
          g.incluirProcesso({
            empresa: m.est,
            competencia,
            numero: 1,
            totais,
            foraDaFolha: 0,
            tabelaLegal: '',
            parametros: '',
            resumo: 'b',
            por: m.login,
          }),
        ),
      ),
    ).toBe('calculo-concorrente');
    // Linha repetida é defeito de quem chama (o serviço nunca repete): erro interno, como o `Error` da porta de memória.
    expect(await codigo(gravar((g) => g.incluirLinhas(r.id, [linhas[0]!])))).toBe('erro-interno');

    // 13º: tipo traduzido, intervalo do ano, data de pagamento.
    const d1 = await gravar(async (g) => {
      const id = await g.incluirProcesso({
        empresa: m.est,
        competencia: '2098-11',
        tipo: 'decimo1',
        pagamento: '2098-11-30',
        numero: 1,
        totais,
        foraDaFolha: 0,
        tabelaLegal: '',
        parametros: '2098-01-01',
        resumo: 'c',
        por: m.login,
      });
      return {
        id,
        vigente: await g.emVigorComTrava(m.est, '2098-12', 'decimo1', { de: '2098-01', ate: '2098-12' }),
      };
    });
    expect(d1.vigente.vigente).toMatchObject({
      id: d1.id,
      tipo: 'decimo1',
      pagamento: '2098-11-30',
      parametros: '2098-01-01',
    });
    expect(d1.vigente.proximoNumero).toBe(1);

    // Troca de situação: versão errada recusa; a certa grava quem e o motivo.
    const p = r.vigente.vigente!;
    const troca = (versao: number) =>
      gravar((g) =>
        g.situacaoProcesso({
          id: p.id,
          versao,
          de: 'calculada',
          para: 'descartada',
          motivo: 'teste',
          por: m.login,
        }),
      );
    expect(await codigo(troca(p.versao + 5))).toBe('desatualizado');
    await troca(p.versao);
    const depois = await gravar((g) => g.processo(p.id));
    expect(depois).toMatchObject({
      situacao: 'descartada',
      motivo: 'teste',
      situacaoPor: m.login,
      versao: p.versao + 1,
    });
    expect(await gravar((g) => g.processosCalculadosComTrava(m.est, '2098-01', '2098-12'))).toEqual([
      expect.objectContaining({ id: d1.id }),
    ]);
    expect(await gravar((g) => g.processosCalculadosComTrava(m.outro, '2098-01', '2098-12'))).toEqual([]);

    // Período fechado: calcular e descartar recusam.
    await m.nucleo.escrever({ cliente: CLIENTE_O3, correlacao: 'teste-folha-executor' }, (e) =>
      e.executar(
        `INSERT INTO fechamento_periodo_folha (estabelecimento_id, apuracao, periodo_inicio, numero, situacao, processamentos,
           totais, resumo, fechado_em, fechado_por_usuario_id, criado_em)
         VALUES (?, 'anual', '2098-01-01', 1, 'fechado', '[]', '{}', 'r', NOW(3), ?, NOW(3))`,
        [m.est, m.usuario],
      ),
    );
    const v13 = d1.vigente.vigente!;
    expect(
      await codigo(
        gravar((g) =>
          g.situacaoProcesso({
            id: v13.id,
            versao: v13.versao,
            de: 'calculada',
            para: 'descartada',
            motivo: 'x',
            por: m.login,
          }),
        ),
      ),
    ).toBe('competencia-fechada');
    expect(
      await codigo(
        gravar((g) =>
          g.incluirProcesso({
            empresa: m.est,
            competencia: '2098-12',
            tipo: 'decimo2',
            pagamento: '2098-12-20',
            numero: 1,
            totais,
            foraDaFolha: 0,
            tabelaLegal: '',
            parametros: '',
            resumo: 'd',
            por: m.login,
          }),
        ),
      ),
    ).toBe('competencia-fechada');
    expect(
      await codigo(
        gravar((g) =>
          g.incluirProcesso({
            empresa: m.outro,
            competencia,
            numero: 1,
            totais,
            foraDaFolha: 0,
            tabelaLegal: '',
            parametros: '',
            resumo: 'e',
            por: m.login,
          }),
        ),
      ),
    ).toBe('empresa-fora-da-sessao');
  });

  it('rescisão: recusa sem desligamento e sem tipo; grava ligada ao processamento; troca a situação', async () => {
    const proc = await gravar((g) =>
      g.incluirProcesso({
        empresa: m.est,
        competencia: '2098-08',
        tipo: 'rescisao',
        pagamento: '2098-08-20',
        numero: 1,
        totais,
        foraDaFolha: 0,
        tabelaLegal: '',
        parametros: '',
        resumo: 'f',
        por: m.login,
      }),
    );
    const nova = {
      vinculo: m.vinculo,
      empresa: m.est,
      desligamento: '2098-08-10',
      tipoRescisao: null as number | null,
      modalidade: 'sem-justa-causa' as const,
      aviso: 'nao-cumprido' as const,
      diasAviso: 33,
      diasIndenizados: 0,
      projecao: '2098-09-12',
      termo: null,
      saldoFgts: 1234.56,
      saldoFgtsInformado: true,
      multaFgts: 493.82,
      pagamento: '2098-08-20',
      processo: proc,
      por: m.login,
    };
    expect(await codigo(gravar((g) => g.incluirRescisao(nova)))).toBe('tipo-rescisao-obrigatorio');
    // Catálogo sintético: a tabela 19 do eSocial (motivo do desligamento) e o tipo de rescisão que aponta para ela.
    await m.nucleo.escrever({ cliente: CLIENTE_O3, correlacao: 'teste-folha-executor' }, async (e) => {
      await e.executar(
        "INSERT INTO tabela_esocial (fonte, codigo_oficial, descricao, versao_fonte, criado_em) VALUES ('esocial', ?, 'TABELA SINTETICA', 't', NOW(3))",
        [MARCA],
      );
      const [t] = await e.consultar('SELECT id FROM tabela_esocial WHERE codigo_oficial = ?', [MARCA]);
      await e.executar(
        "INSERT INTO codigo_esocial (tabela_esocial_id, codigo_esocial, descricao, criado_em) VALUES (?, '99', 'MOTIVO SINTETICO', NOW(3))",
        [t!['id']],
      );
      const [c] = await e.consultar('SELECT id FROM codigo_esocial WHERE tabela_esocial_id = ?', [t!['id']]);
      await e.executar(
        `INSERT INTO tipo_rescisao (codigo, descricao, iniciativa, motivo_desligamento_codigo_esocial_id, criado_em)
         VALUES (?, 'TIPO SINTETICO', 'empregador', ?, NOW(3))`,
        [MARCA, c!['id']],
      );
      const [tr] = await e.consultar('SELECT id FROM tipo_rescisao WHERE codigo = ?', [MARCA]);
      tipoRescisao = Number(tr!['id']);
    });
    // Vínculo ainda ativo: não há desligamento nesta data.
    expect(await codigo(gravar((g) => g.incluirRescisao({ ...nova, tipoRescisao })))).toBe(
      'desligamento-nao-registrado',
    );
    // O desligamento pelo caminho real: a porta própria de pessoas (só marca o vínculo), sem INSERT manual.
    const pessoas = new PortaPessoasPropria(m.nucleo, {} as never, exec);
    const vinculo = (await pessoas.vinculo(ctx(), m.vinculo))!;
    await pessoas.gravarSgh(
      ctx(),
      { ...trilha, estabelecimento: m.est, usuario: m.usuario, acao: 'alteracao', entidade: 'vinculo_trabalho' },
      (g) =>
        g.desligarVinculo({
          id: m.vinculo,
          versao: vinculo.versao,
          data: '2098-08-10',
          tipoRescisao,
          motivo: 'Desligamento sintético',
          por: m.login,
        }),
    );
    const id = await gravar((g) => g.incluirRescisao({ ...nova, tipoRescisao }));
    const deslig = await m.nucleo.lerSomente(ctx(), (l) =>
      l.consultar(
        `SELECT d.situacao, d.iniciativa, d.aviso_previo, d.tipo_rescisao_id, d.motivo_codigo_esocial_id IS NOT NULL AS motivo,
                (SELECT COUNT(*) FROM rescisao r WHERE r.desligamento_id = d.id) AS rescisoes
           FROM desligamento d WHERE d.vinculo_trabalho_id = ? AND d.data_desligamento = '2098-08-10'`,
        [m.vinculo],
      ),
    );
    expect(deslig.map((d) => ({ ...d, tipo_rescisao_id: Number(d['tipo_rescisao_id']) }))).toEqual([
      expect.objectContaining({
        situacao: 'confirmado',
        iniciativa: 'empregador',
        aviso_previo: 'trabalhado',
        tipo_rescisao_id: tipoRescisao,
      }),
    ]);
    expect(Number(deslig[0]!['motivo'])).toBe(1);
    expect(Number(deslig[0]!['rescisoes'])).toBe(1);
    const lidas = await gravar((g) => g.rescisoesDoVinculoComTrava(m.vinculo));
    expect(lidas.desligamento).toBe('2098-08-10');
    expect(lidas.tipoRescisao).toBe(tipoRescisao);
    expect(lidas.rescisoes).toHaveLength(1);
    const r = lidas.rescisoes[0]!;
    expect(r).toMatchObject({
      id,
      vinculo: m.vinculo,
      empresa: m.est,
      desligamento: '2098-08-10',
      tipoRescisao,
      modalidade: 'sem-justa-causa',
      aviso: 'nao-cumprido',
      diasAviso: 33,
      diasIndenizados: 0,
      projecao: '2098-09-12',
      termo: null,
      saldoFgts: 1234.56,
      saldoFgtsInformado: true,
      multaFgts: 493.82,
      pagamento: '2098-08-20',
      situacao: 'calculada',
      processo: proc,
      motivo: null,
      registradoPor: m.login,
      situacaoPor: null,
    });
    // Conferida fora do cálculo e uma simulação no mesmo desligamento: a releitura com trava filtra e traduz como a
    // leitura da montagem, e o carimbo do serviço (id:situação:versão) bate.
    await m.nucleo.escrever({ cliente: CLIENTE_O3, correlacao: 'teste-folha-executor' }, async (e) => {
      const cols = (
        await e.consultar(
          `SELECT column_name AS c FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'rescisao' AND column_name NOT IN ('id', 'situacao', 'numero_complementar')
            ORDER BY ordinal_position`,
          [],
        )
      ).map((x) => String(x['c'] ?? x['C']));
      await e.executar(
        `INSERT INTO rescisao (${cols.join(', ')}, situacao, numero_complementar)
         SELECT ${cols.join(', ')}, 'simulacao', 90 FROM rescisao WHERE id = ?`,
        [id],
      );
      await e.executar("UPDATE rescisao SET situacao = 'conferida' WHERE id = ?", [id]);
    });
    const carimbo = (xs: readonly { id: number; situacao: string; versao: number }[]) =>
      xs.map((x) => `${x.id}:${x.situacao}:${x.versao}`).sort().join(',');
    const montagem = await m.nucleo.lerSomente(ctx(), async (l) => ({
      rescisoes: await lerRescisoes(l, m.est, { vinculo: m.vinculo }),
      ferias: await lerFerias(l, m.est, { vinculo: m.vinculo }),
    }));
    const relida = await gravar(async (g) => ({
      t: await g.rescisoesDoVinculoComTrava(m.vinculo),
      ferias: await g.feriasDoVinculoComTrava(m.vinculo),
    }));
    expect(relida.t.rescisoes.map((x) => [x.id, x.situacao])).toEqual([[id, 'calculada']]);
    expect(carimbo(relida.t.rescisoes)).toBe(carimbo(montagem.rescisoes));
    expect(carimbo(relida.ferias)).toBe(carimbo(montagem.ferias));
    const troca = (versao: number) =>
      gravar((g) =>
        g.situacaoRescisao({
          id,
          versao,
          de: 'calculada',
          para: 'substituida',
          motivo: 'recálculo',
          por: m.login,
        }),
      );
    expect(await codigo(troca(r.versao + 1))).toBe('desatualizado');
    await troca(r.versao);
    const id2 = await gravar((g) => g.incluirRescisao({ ...nova, tipoRescisao }));
    const depois = (await gravar((g) => g.rescisoesDoVinculoComTrava(m.vinculo))).rescisoes;
    expect(depois.map((x) => [x.id, x.situacao, x.motivo])).toEqual([
      [id, 'substituida', 'recálculo'],
      [id2, 'calculada', null],
    ]);
    // Outro estabelecimento não vê o vínculo.
    expect(
      await gravacaoDireta(
        exec,
        { ...ctx(), estabelecimento: m.outro },
        {
          nome: 'pessoas.calculo_folha.gravar',
          tabelas: TABELAS_FOLHA_EXECUTOR,
          trilha,
          gravador: (tx, est) => gravadorFolhaExecutor(tx, est),
          fn: (g) => g.rescisoesDoVinculoComTrava(m.vinculo),
        },
      ),
    ).toEqual({ desligamento: null, tipoRescisao: null, rescisoes: [] });
  });

  it('parâmetros das obrigações: o JSON inválido recusa; a vigência repetida recusa', async () => {
    expect(
      await codigo(
        gravar((g) =>
          g.incluirParametrosObrigacoes({ empresa: m.est, inicio: '2098-01', dados: '{}', por: m.login }),
        ),
      ),
    ).not.toBe('ok');
    expect(
      await codigo(
        gravar((g) =>
          g.incluirParametrosObrigacoes({ empresa: m.outro, inicio: '2098-01', dados: '{}', por: m.login }),
        ),
      ),
    ).toBe('empresa-fora-da-sessao');
  });

  it('férias relidas pela leitura do cálculo; marcá-las calculadas e as obrigações seguem com modelo-pendente', async () => {
    expect(await gravar((g) => g.feriasDoVinculoComTrava(m.vinculo))).toEqual([]);
    expect(
      await codigo(
        gravar((g) =>
          g.situacaoFerias({ id: 0, versao: 1, de: 'programada', para: 'cancelada', motivo: 'x', por: m.login }),
        ),
      ),
    ).toBe('desatualizado');
    expect(
      await codigo(
        gravar((g) =>
          g.situacaoFerias({ id: 0, versao: 1, de: 'programada', para: 'calculada', motivo: null, por: m.login }),
        ),
      ),
    ).toBe('modelo-pendente');
    expect(await codigo(gravar((g) => g.obrigacaoComTrava(1)))).toBe('modelo-pendente');
  });

  it('ficha do eSocial: nova, troca pela versão, recusa a desatualizada e o vínculo de fora', async () => {
    const g = <T>(
      est: number,
      fn: (tx: Parameters<typeof gravarFichaEsocial>[0], est: number) => Promise<T>,
    ) =>
      gravacaoDireta(
        exec,
        { ...ctx(), estabelecimento: est },
        {
          nome: 'pessoas.esocial.ficha',
          tabelas: [TABELA_FICHA_ESOCIAL],
          trilha: { ...trilha, entidade: TABELA_FICHA_ESOCIAL },
          gravador: (tx, e) => ({ tx, e }),
          fn: ({ tx, e }) => fn(tx, e),
        },
      );
    const ler = (est: number) => m.nucleo.lerSomente(ctx(), (l) => lerFichaEsocial(l, est, m.vinculo));
    expect(await ler(m.est)).toBeNull();
    const a = await g(m.est, (tx, e) =>
      gravarFichaEsocial(tx, e, {
        vinculo: m.vinculo,
        dadosCifrados: 'cifra-sintetica-1',
        versao: null,
        por: m.login,
      }),
    );
    expect(await ler(m.est)).toMatchObject({
      id: a.id,
      vinculo: m.vinculo,
      dadosCifrados: 'cifra-sintetica-1',
      versao: a.versao,
      alteradoPor: m.login,
    });
    expect(
      await codigo(
        g(m.est, (tx, e) =>
          gravarFichaEsocial(tx, e, { vinculo: m.vinculo, dadosCifrados: 'x', versao: null, por: m.login }),
        ),
      ),
    ).toBe('desatualizado');
    const b = await g(m.est, (tx, e) =>
      gravarFichaEsocial(tx, e, {
        vinculo: m.vinculo,
        dadosCifrados: 'cifra-sintetica-2',
        versao: a.versao,
        por: m.login,
      }),
    );
    expect(b).toEqual({ id: a.id, versao: a.versao + 1 });
    expect(
      await codigo(
        g(m.est, (tx, e) =>
          gravarFichaEsocial(tx, e, {
            vinculo: m.vinculo,
            dadosCifrados: 'x',
            versao: a.versao,
            por: m.login,
          }),
        ),
      ),
    ).toBe('desatualizado');
    expect(
      await codigo(
        g(m.outro, (tx, e) =>
          gravarFichaEsocial(tx, e, { vinculo: m.vinculo, dadosCifrados: 'x', versao: null, por: m.login }),
        ),
      ),
    ).toBe('vinculo-inexistente');
    expect((await ler(m.est))?.dadosCifrados).toBe('cifra-sintetica-2');
    expect(await ler(m.outro)).toBeNull();
  });
});
