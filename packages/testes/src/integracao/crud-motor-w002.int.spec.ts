// W0-02 sobre a cópia (sob a trava da cópia; tudo em transação desfeita): o motor do CRUD genérico com os verbos novos,
// pelo EXECUTOR, sobre tabelas reais do cadastro anterior e com declarações de teste que acrescentam `excluir` a
// domínios reais (o pacote não declara domínio; as operações de teste ficam fora do catálogo e o executor as aceita como
// especificadas, como em dev):
//   1. excluir alergia referenciada por FK declarada (alergias do paciente) → 409 com-dependentes, contagem e amostra;
//      a linha continua no banco;
//   2. excluir princípio ativo referenciado SÓ por código (histórico do princípio, sem FK; o mapa de dependências) → 409;
//   3. excluir alergia nunca usada (incluída na transação) → a linha some, o retrato inteiro vai à SGH_HIST_EXCLUSAO, o
//      evento (motivo e valor anterior) à SGH_CRUD_EVENTO e a trilha (quem, quando, operação, alvo) à SGH_TRILHA;
//   4. excluir a situação de higienização 4 (sem dependente) → o gatilho TRG_CHSITUACAO_BD recusa: 409 com a mensagem
//      do catálogo das exceções, e nenhum retrato fica (a operação inteira é desfeita);
//   5. reativar tipo de limpeza (coluna de situação do legado; operação do catálogo) → ATIVO = 'T' e o evento;
//   6. chave composta (característica × dieta): incluir, alterar a ordem e excluir;
//   7. texto longo (método do SADT, BLOB de texto): mais de 64 KiB com acentuação CP1252, gravado e relido idêntico;
//   8. vigia de reconciliação ligada pelo parâmetro: a exclusão simulada por fora (DELETE direto) aparece no relatório,
//      a feita pelo Sante não;
//   9. os pilotos do catálogo (rodada 2), pelas operações do catálogo: excluir característica de dieta lançada em
//      prescrição (FK PRCARACTLAN) → 409; a nunca usada → apagada com retrato; as respostas possíveis (BLOB) com mais de
//      64 KiB e acentuação, relidas idênticas.
// Revisão do W0-02 (achados do corretor):
//  10. a ligação característica × dieta inativada só no novo e excluída: a marca da SGH_CFG_DOMINIO_SITUACAO sai na mesma
//      transação e o mesmo par incluído de novo nasce ATIVO (e se altera);
//  11. a alteração das respostas possíveis (BLOB) grava o evento "alterado" com o texto anterior; a inativação, o evento
//      "inativado" com o motivo;
//  12. a vigia: a exclusão do Sante com o evento gravado ANTES da leitura (a linha ainda presente no retrato) não vira
//      "feita fora".
// Contagens iguais antes e depois (ROLLBACK). Saída só com contagens e códigos.
import type { DeclaracaoDominio } from '@sgh/contratos';
import {
  declaracao,
  fonteCatalogoArquivo,
  inativarSoNoNovo,
  itemDoDominio,
  mapaDoDominio,
  operacao,
  operacoesDoDominio,
  type OperacaoDominio,
  relatorioExclusoesFora,
  rodarVigia,
  rotuloDaTabelaDeDominio,
  usoDoItem,
  verificarDependencias,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  alergiaDePaciente,
  CONTAGENS_W002,
  excluirTipoLimpezaPorFora,
  ligarVigiaNaTransacao,
  linhaDoPrincipio,
  parDietaCaracteristicaLivre,
  primeiroMetodo,
  principiosNoHistorico,
  registrarExclusaoPeloSante,
  retratoEEventoDaExclusao,
  situacaoDoTipoLimpeza,
  textoDoMetodo,
  caracteristicaLancada,
  marcasNoNovo,
  respostasDaCaracteristica,
  ultimoEvento,
} from '../massa/crud-motor-w002.js';
import { textoLongoCp1252 } from '../massa/reproducao-dominios.js';
import {
  type Ambiente,
  CATALOGO,
  contar,
  ctx,
  ctxOperacao,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

type Escritor = Parameters<Parameters<Ambiente['nucleo']['desfazendoNaCopia']>[1]>[0];
type Executor = Ambiente['executor'];

function comExcluir(id: string, extra: Partial<DeclaracaoDominio> = {}): DeclaracaoDominio {
  const d = declaracao(id)!;
  return {
    ...d,
    publico: {
      ...d.publico,
      acoes: [...new Set([...d.publico.acoes, 'excluir' as const])],
      categoria: 'dominio',
    },
    exclusao: {
      referenciasLogicas: [],
      semReferenciasLogicas: 'declaração de teste do W0-02 (o mapa real fica com o pacote dono do domínio)',
    },
    ...extra,
  };
}

const ALERGIA = comExcluir('cadastro.alergia');
const PRINCIPIO = comExcluir('cadastro.principioAtivo', {
  exclusao: {
    referenciasLogicas: [
      {
        tabela: 'HTPRINC',
        colunas: ['ID_TBPRINC'],
        evidencia:
          'histórico do princípio ativo gravado pelo programa (sem FK; config/levantamento/historicos.ts) — 137 linhas na cópia pc',
        rotulo: 'Histórico do princípio ativo',
      },
    ],
  },
});
const SITUACAO = comExcluir('internacao.situacaoHigienizacao');
// Revisão do W0-02: a exclusão recusa antes o item de sistema declarado (1 a 4); para provar a tradução da recusa do
// GATILHO, a declaração de teste tira a marca (como um domínio cuja declaração não conhece o item protegido).
const SITUACAO_SEM_MARCA: DeclaracaoDominio = {
  ...SITUACAO,
  publico: { ...SITUACAO.publico, recurso: 'situacaoHigienizacaoSemMarca' },
  situacao: Object.fromEntries(
    Object.entries(SITUACAO.situacao!).filter(([k]) => k !== 'protegidas'),
  ) as unknown as NonNullable<DeclaracaoDominio['situacao']>,
};
// Pilotos declarados no catálogo (rodada 2): a ligação característica × dieta exclui pela operação do catálogo.
const CARACTERISTICA_DIETA: DeclaracaoDominio = declaracao('pep.caracteristicaDaDieta')!;
const METODO: DeclaracaoDominio = (() => {
  const d = declaracao('sadt.metodo')!;
  return {
    ...d,
    publico: { ...d.publico, acoes: [...new Set([...d.publico.acoes, 'editar' as const])] },
    textosLongos: (d.textosLongos ?? []).map((t) => ({ ...t, editavel: true })),
  };
})();
const TESTE = [ALERGIA, PRINCIPIO, SITUACAO, SITUACAO_SEM_MARCA, METODO];

const OPS: Record<string, OperacaoDominio> = Object.fromEntries(
  TESTE.flatMap((d) =>
    operacoesDoDominio(
      d,
      (tx, decl, c) => usoDoItem(tx, decl, c),
      (id) => declaracao(id),
      rotuloDaTabelaDeDominio,
    ),
  ).map((o) => [o.receita.nome, o]),
);
async function codigoDa(
  p: Promise<unknown>,
): Promise<{ codigo: string; problema?: Record<string, unknown> }> {
  try {
    await p;
    return { codigo: 'gravou' };
  } catch (e) {
    const pr = (e as { problema?: Record<string, unknown> }).problema;
    if (pr && typeof pr['codigo'] === 'string') return { codigo: pr['codigo'], problema: pr };
    throw e;
  }
}

describe.skipIf(!PODE_ESCREVER)('W0-02: motor do CRUD genérico na cópia (transação desfeita)', () => {
  let a: Ambiente;
  let ex: Executor;
  beforeAll(async () => {
    a = await prepararAmbiente();
    // As operações de teste (fora do catálogo) correm como especificadas, como em dev; as do catálogo, pelo catálogo.
    const base = fonteCatalogoArquivo(CATALOGO);
    ex = a.nucleo.criarExecutor({
      catalogo: {
        estado: (n, h) => (OPS[n] && !base.estado(n, h) ? 'especificada' : base.estado(n, h)),
        motivo: (n, h) => base.motivo?.(n, h) ?? null,
      },
    });
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  const retrato = () =>
    a.nucleo.lerSomente(ctx(a), async (l) => ({
      alergia: await contar(l, CONTAGENS_W002.alergias),
      principio: await contar(l, CONTAGENS_W002.principios),
      situacao: await contar(l, CONTAGENS_W002.situacoes),
      caracteristica: await contar(l, CONTAGENS_W002.caracteristicasDieta),
      hist: await contar(l, CONTAGENS_W002.retratos),
      evento: await contar(l, CONTAGENS_W002.eventos),
      vigia: await contar(l, CONTAGENS_W002.retratosVigia),
      achado: await contar(l, CONTAGENS_W002.achadosVigia),
      metodo: await contar(l, CONTAGENS_W002.metodosTextoLongo),
    }));

  const executar = (e: Escritor, nome: string, entrada: unknown, por = 'SGH.TESTE.W002') =>
    ex.executar(OPS[nome] ?? operacao(nome), a.cod, entrada, ctxOperacao(a, por), { escritor: e });

  it('1, 2 e 3: recusa por FK e por referência lógica (409 com contagem e amostra); o nunca usado é apagado com retrato, evento e trilha', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      // 1. Alergia com alergias de paciente (FK PRALERGIAPAC.ID_TBALERGIA).
      const cod1 = await alergiaDePaciente(e);
      const item1 = await itemDoDominio(e, ALERGIA, cod1);
      const fk = await codigoDa(
        executar(e, 'cadastro.excluirAlergia', {
          codigo: cod1,
          versao: item1!.versao,
          motivo: 'teste W0-02 com vínculo',
        }),
      );
      const continua = await contar(e, CONTAGENS_W002.alergiaPorId, [Number(cod1)]);
      // 2. Princípio ativo só no histórico (HTPRINC.ID_TBPRINC, sem FK): o primeiro sem nenhuma FK de entrada usada
      // (conferido pelo próprio verificador, só com as FKs do catálogo).
      const candidatos = await principiosNoHistorico(e);
      let cod2 = '';
      for (const c of candidatos) {
        const linha = await linhaDoPrincipio(e, c);
        if (!linha) continue;
        const soFk = await verificarDependencias(e, {
          mapa: { ...mapaDoDominio(PRINCIPIO), referenciasLogicas: [] },
          linha,
          chave: [c],
        });
        if (soFk.length === 0) {
          cod2 = String(c);
          break;
        }
      }
      expect(cod2).not.toBe('');
      const item2 = await itemDoDominio(e, PRINCIPIO, cod2);
      const logica = await codigoDa(
        executar(e, 'cadastro.excluirPrincipioAtivo', {
          codigo: cod2,
          versao: item2!.versao,
          motivo: 'teste W0-02 só lógico',
        }),
      );
      // 3. Alergia nova (pela operação do catálogo), sem uso, excluída com o motivo.
      const inc = await executar(e, 'cadastro.incluirAlergia', {
        nome: `ALERGIA SINTETICA W002 ${Date.now() % 1e6}`,
      });
      const cod3 = String(inc.resultado['codigo']);
      const item3 = await itemDoDominio(e, ALERGIA, cod3);
      const exc = await executar(e, 'cadastro.excluirAlergia', {
        codigo: cod3,
        versao: item3!.versao,
        motivo: 'cadastrada por engano (teste W0-02)',
      });
      const { hist, linha, ev, valorAnterior } = await retratoEEventoDaExclusao(e, a.cod, 'TBALERGIA', cod3);
      const trilha = await contar(e, CONTAGENS_W002.trilhaExclusaoAlergia, [cod3, a.cod]);
      return {
        fk,
        continua,
        logica,
        exc: exc.resultado['codigo'] === cod3,
        apagada: await contar(e, CONTAGENS_W002.alergiaPorId, [Number(cod3)]),
        hist: hist
          ? {
              operacao: String(hist['OPERACAO']).trim(),
              motivo: String(hist['MOTIVO']).trim(),
              por: String(hist['EXCLUIDO_POR']).trim(),
            }
          : null,
        colunasRetrato: linha ? Object.keys(linha).sort() : [],
        evento: ev ? { evento: String(ev['EVENTO']).trim(), motivo: String(ev['MOTIVO']).trim() } : null,
        valorAnterior,
        trilha,
      };
    });
    expect(r.fk.codigo).toBe('com-dependentes');
    expect(r.fk.problema?.['status']).toBe(409);
    const depFk = r.fk.problema?.['dependentes'] as {
      quantidade: number;
      amostra: string[];
      origem: string;
    }[];
    expect(depFk.some((x) => x.origem === 'fk' && x.quantidade > 0 && x.amostra.length > 0)).toBe(true);
    expect(r.fk.problema?.['podeInativar']).toBe(true);
    expect(r.continua).toBe(1);
    expect(r.logica.codigo).toBe('com-dependentes');
    const depLog = r.logica.problema?.['dependentes'] as {
      quantidade: number;
      origem: string;
      rotulo: string;
    }[];
    expect(depLog).toEqual([
      expect.objectContaining({ origem: 'logica', rotulo: 'Histórico do princípio ativo' }),
    ]);
    expect(depLog[0]!.quantidade).toBeGreaterThan(0);
    expect(r.exc).toBe(true);
    expect(r.apagada).toBe(0);
    expect(r.hist).toEqual({
      operacao: 'cadastro.excluirAlergia',
      motivo: 'cadastrada por engano (teste W0-02)',
      por: 'SGH.TESTE.W002',
    });
    expect(r.colunasRetrato).toEqual(expect.arrayContaining(['ID', 'NOME', 'ATIVO']));
    expect(r.evento).toEqual({ evento: 'excluido', motivo: 'cadastrada por engano (teste W0-02)' });
    expect(r.valorAnterior).toMatchObject({ ativo: true });
    expect(r.trilha).toBe(1);
    expect(await retrato()).toEqual(antes);
    console.log(
      `[${a.cod}] W0-02 exclusão: FK → ${r.fk.codigo} (${depFk.map((x) => `${x.quantidade} em ${(x as { rotulo?: string }).rotulo}`).join('; ')}); lógica → ${r.logica.codigo} (${depLog.map((x) => `${x.quantidade} em ${x.rotulo}`).join('; ')}); nunca usada → apagada, retrato com ${r.colunasRetrato.length} colunas, evento ${r.evento?.evento}, trilha ${r.trilha}`,
    );
  });

  it('4: a recusa do gatilho BD do legado chega com a mensagem do catálogo, sem retrato órfão', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const hist0 = await contar(e, CONTAGENS_W002.retratosSituacao);
      const item = await itemDoDominio(e, SITUACAO, '4');
      // Revisão do W0-02: com a marca de item de sistema, a exclusão nem chega ao banco (como a inativação).
      const sistema = await codigoDa(
        executar(e, 'internacao.excluirSituacaoHigienizacao', {
          codigo: '4',
          versao: item!.versao,
          motivo: 'teste W0-02 do item de sistema',
        }),
      );
      const g = await codigoDa(
        executar(e, 'internacao.excluirSituacaoHigienizacaoSemMarca', {
          codigo: '4',
          versao: item!.versao,
          motivo: 'teste W0-02 do gatilho',
        }),
      );
      return {
        sistema: sistema.codigo,
        g,
        continua: await contar(e, CONTAGENS_W002.situacao4),
        hist: (await contar(e, CONTAGENS_W002.retratosSituacao)) - hist0,
        evento: await contar(e, CONTAGENS_W002.eventosSituacao),
      };
    });
    expect(r.sistema).toBe('item-de-sistema');
    expect(r.g.codigo).toBe('recusa-do-gatilho');
    expect(String(r.g.problema?.['detail'])).toMatch(/Exclus[aã]o n[aã]o permitida/);
    expect(r.continua).toBe(1);
    expect(r.hist).toBe(0);
    expect(r.evento).toBe(0);
    expect(await retrato()).toEqual(antes);
    console.log(
      `[${a.cod}] W0-02 gatilho: ${r.g.codigo} — "${String(r.g.problema?.['detail'])}"; retratos órfãos: ${r.hist}`,
    );
  });

  it('5: reativar pela coluna de situação grava a letra de ativo, com o evento (motivo e valor anterior)', async () => {
    const antes = await retrato();
    const d = declaracao('internacao.tipoLimpeza')!;
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const inc = await executar(e, 'internacao.incluirTipoLimpeza', {
        nome: `LIMPEZA SINTETICA W002 ${Date.now() % 1e6}`,
        tempoPrevisto: '00:30',
      });
      const cod = String(inc.resultado['codigo']);
      const v1 = (await itemDoDominio(e, d, cod))!.versao;
      await executar(e, 'internacao.inativarTipoLimpeza', { codigo: cod, versao: v1 });
      const inativo = (await itemDoDominio(e, d, cod))!;
      await executar(e, 'internacao.reativarTipoLimpeza', {
        codigo: cod,
        versao: inativo.versao,
        motivo: 'voltou a ser usado (teste W0-02)',
      });
      const situacao = await situacaoDoTipoLimpeza(e, cod);
      const ev = await contar(e, CONTAGENS_W002.eventoReativacaoLimpeza, [
        cod,
        'voltou a ser usado (teste W0-02)',
      ]);
      const ja = await codigoDa(
        executar(e, 'internacao.reativarTipoLimpeza', {
          codigo: cod,
          versao: (await itemDoDominio(e, d, cod))!.versao,
          motivo: 'segunda vez (teste W0-02)',
        }),
      );
      return { inativoAntes: inativo.ativo, ativo: situacao, ev, ja: ja.codigo };
    });
    expect(r).toEqual({ inativoAntes: false, ativo: 'T', ev: 1, ja: 'ja-ativo' });
    expect(await retrato()).toEqual(antes);
    console.log(`[${a.cod}] W0-02 reativar: inativo → ATIVO=${r.ativo}; evento ${r.ev}; de novo → ${r.ja}`);
  });

  it('6: chave composta (característica × dieta): incluir, alterar e excluir', async () => {
    const antes = await retrato();
    const dieta = declaracao('internacao.dieta')!;
    const carac = declaracao('pep.caracteristicaDieta')!;
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const par = await parDietaCaracteristicaLivre(e, dieta, carac);
      const valores = { dieta: par.dieta, caracteristica: par.caracteristica, ordem: '1' };
      const inc = await executar(e, 'pep.incluirCaracteristicaDaDieta', valores);
      const cod = String(inc.resultado['codigo']);
      const v1 = (await itemDoDominio(e, CARACTERISTICA_DIETA, cod))!.versao;
      await executar(e, 'pep.alterarCaracteristicaDaDieta', {
        codigo: cod,
        versao: v1,
        valores: { ordem: '7' },
      });
      const alterado = (await itemDoDominio(e, CARACTERISTICA_DIETA, cod))!;
      await executar(e, 'pep.excluirCaracteristicaDaDieta', {
        codigo: cod,
        versao: alterado.versao,
        motivo: 'ligação incluída por engano (teste W0-02)',
      });
      return {
        composta: cod.includes('|'),
        ordem: String(alterado.valores['ordem']).trim(),
        resta: await contar(e, CONTAGENS_W002.caracteristicaDietaPar, [
          valores.dieta,
          valores.caracteristica,
        ]),
        retrato: await contar(e, CONTAGENS_W002.retratoCaracteristicaDieta, [cod]),
      };
    });
    expect(r).toEqual({ composta: true, ordem: '7', resta: 0, retrato: 1 });
    expect(await retrato()).toEqual(antes);
    console.log(
      `[${a.cod}] W0-02 chave composta: incluir, alterar (ordem ${r.ordem}) e excluir com retrato ${r.retrato}`,
    );
  });

  it('7: texto longo (BLOB de texto) com acentuação CP1252 e mais de um segmento, relido idêntico', async () => {
    const antes = await retrato();
    const texto = `Método com acentuação: ção, ã, é, ü, ¿, “aspas”, € — ${'linha de texto longo áéíóú ÇÑ ºª '.repeat(2400)}`;
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const cod = await primeiroMetodo(e);
      const v = (await itemDoDominio(e, METODO, cod))!.versao;
      await executar(e, 'sadt.alterarMetodo', { codigo: cod, versao: v, valores: { descr: texto } });
      const bytes = await textoDoMetodo(e, cod);
      return { bytes: bytes.length, igual: new TextDecoder('windows-1252').decode(bytes) === texto };
    });
    expect(r.bytes).toBeGreaterThan(65_535);
    expect(r.igual).toBe(true);
    expect(await retrato()).toEqual(antes);
    console.log(
      `[${a.cod}] W0-02 texto longo: ${r.bytes} bytes (mais de um segmento de 64 KiB), relido idêntico: ${r.igual}`,
    );
  });

  it('8: a vigia de reconciliação, ligada pelo parâmetro, acha a exclusão feita por fora (e não a do Sante)', async () => {
    const antes = await retrato();
    const d = declaracao('internacao.tipoLimpeza')!;
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      // Desligada (sem valor do parâmetro neste estabelecimento): nada é lido nem gravado.
      const desligada = await rodarVigia(e, a.cod, [d]);
      await ligarVigiaNaTransacao(e, a.nucleo.rede, a.cod);
      const i1 = await executar(e, 'internacao.incluirTipoLimpeza', {
        nome: `VIGIA FORA W002 ${Date.now() % 1e6}`,
        tempoPrevisto: '00:10',
      });
      const i2 = await executar(e, 'internacao.incluirTipoLimpeza', {
        nome: `VIGIA SANTE W002 ${Date.now() % 1e6}`,
        tempoPrevisto: '00:10',
      });
      const fora = String(i1.resultado['codigo']);
      const santeCod = String(i2.resultado['codigo']);
      const base = await rodarVigia(e, a.cod, [d]);
      // Exclusão por fora (como o programa anterior apagaria): DELETE direto, sem o Sante.
      await excluirTipoLimpezaPorFora(e, fora);
      // Exclusão pelo Sante (registro do evento): a vigia a reconhece.
      await registrarExclusaoPeloSante(e, a.cod, 'CHTPLIMPEZA', santeCod);
      await excluirTipoLimpezaPorFora(e, santeCod);
      const depois = await rodarVigia(e, a.cod, [d]);
      const rel = await relatorioExclusoesFora(e, a.cod, rotuloDaTabelaDeDominio);
      return { desligada, base, depois, rel: rel.filter((x) => x.tabela === 'CHTPLIMPEZA'), fora, santeCod };
    });
    expect(r.desligada).toEqual({ ligada: false, tabelas: 0, achados: [] });
    expect(r.base).toMatchObject({ ligada: true, tabelas: 1 });
    expect(r.depois.achados).toEqual([
      expect.objectContaining({ tabela: 'CHTPLIMPEZA', foraDoSante: [r.fora], peloSante: [r.santeCod] }),
    ]);
    expect(r.rel[0]).toMatchObject({ rotulo: d.publico.rotulo.plural, foraDoSante: 1, chaves: [r.fora] });
    expect(r.rel[0]!.contagemAntes - r.rel[0]!.contagemDepois).toBe(2);
    expect(await retrato()).toEqual(antes);
    console.log(
      `[${a.cod}] W0-02 vigia: desligada sem leitura; ligada: ${r.depois.achados.length} achado (fora do Sante: ${r.depois.achados[0]?.foraDoSante.length}, pelo Sante: ${r.depois.achados[0]?.peloSante.length}); relatório "${r.rel[0]?.rotulo}": ${r.rel[0]?.foraDoSante} exclusão fora do Sante`,
    );
  });

  it('9: pilotos do catálogo — excluir característica de dieta (FK → 409; nunca usada → apagada) e o texto longo dela', async () => {
    const antes = await retrato();
    const carac = declaracao('pep.caracteristicaDieta')!;
    const texto = textoLongoCp1252();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      // Lançada em prescrição de dieta (PRCARACTLAN, FK_PRCARACTLAN_PRCARACTDIE): recusa com a contagem.
      const usada = await caracteristicaLancada(e);
      const iu = (await itemDoDominio(e, carac, usada))!;
      const recusada = await codigoDa(
        executar(e, 'pep.excluirCaracteristicaDieta', {
          codigo: usada,
          versao: iu.versao,
          motivo: 'teste W0-02 com vínculo',
        }),
      );
      const dependentes = (recusada.problema?.['dependentes'] ?? []) as { quantidade: number }[];
      // Nunca usada (incluída na transação): apagada, com o retrato.
      const inc = await executar(e, 'pep.incluirCaracteristicaDieta', {
        descricao: `W002 PILOTO ${Date.now() % 1e6}`,
        tipoResposta: 1,
      });
      const nova = String(inc.resultado['codigo']);
      // Texto longo na alteração (as respostas possíveis), relido idêntico.
      const v1 = (await itemDoDominio(e, carac, nova))!.versao;
      await executar(e, 'pep.alterarCaracteristicaDieta', {
        codigo: nova,
        versao: v1,
        valores: { possiveisRespostas: texto },
      });
      const bytes = await respostasDaCaracteristica(e, nova);
      const v2 = (await itemDoDominio(e, carac, nova))!.versao;
      await executar(e, 'pep.excluirCaracteristicaDieta', {
        codigo: nova,
        versao: v2,
        motivo: 'característica incluída por engano (teste W0-02)',
      });
      return {
        recusa: recusada.codigo,
        comDependentes: dependentes.some((x) => x.quantidade > 0),
        bytes: bytes.length,
        igual: new TextDecoder('windows-1252').decode(bytes) === texto,
        resta: await contar(e, CONTAGENS_W002.caracteristicaPorId, [Number(nova)]),
        retrato: await contar(e, CONTAGENS_W002.retratoCaracteristica, [nova]),
      };
    });
    expect(r).toMatchObject({
      recusa: 'com-dependentes',
      comDependentes: true,
      igual: true,
      resta: 0,
      retrato: 1,
    });
    expect(r.bytes).toBeGreaterThan(65_535);
    expect(await retrato()).toEqual(antes);
    console.log(
      `[${a.cod}] W0-02 pilotos: excluir característica lançada → ${r.recusa}; nunca usada → apagada, retrato ${r.retrato}; respostas possíveis ${r.bytes} bytes relidas idênticas: ${r.igual}`,
    );
  });

  it('10: a ligação inativada só no novo e excluída leva a marca junto; o mesmo par incluído de novo nasce ativo', async () => {
    const antes = await retrato();
    const dieta = declaracao('internacao.dieta')!;
    const carac = declaracao('pep.caracteristicaDieta')!;
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const par = await parDietaCaracteristicaLivre(e, dieta, carac);
      const valores = { dieta: par.dieta, caracteristica: par.caracteristica, ordem: '1' };
      const cod = String(
        (await executar(e, 'pep.incluirCaracteristicaDaDieta', valores)).resultado['codigo'],
      );
      const v1 = (await itemDoDominio(e, CARACTERISTICA_DIETA, cod))!;
      await inativarSoNoNovo(
        e,
        CARACTERISTICA_DIETA,
        { codigo: cod, versao: v1.versao, usuario: 'SGH.TESTE.W002' },
        {
          rede: a.nucleo.rede,
          hospital: a.cod,
          usuario: 'SGH.TESTE.W002',
          evento: 'pep.caracteristicaDaDieta.inativadoNoNovo',
          recurso: 'pep.caracteristicaDaDieta',
          operacao: 'pep.inativarNoNovo',
          resultado: 'sucesso',
          estacao: null,
          correlacao: 'teste-w002-revisao',
        },
      );
      const inativo = (await itemDoDominio(e, CARACTERISTICA_DIETA, cod))!;
      const marcaAntes = await marcasNoNovo(e, 'PRCARACT_TBDIETAS', cod);
      await executar(e, 'pep.excluirCaracteristicaDaDieta', {
        codigo: cod,
        versao: inativo.versao,
        motivo: 'ligação inativada e excluída (teste W0-02)',
      });
      const marcaDepois = await marcasNoNovo(e, 'PRCARACT_TBDIETAS', cod);
      const ev = await ultimoEvento(e, a.cod, 'PRCARACT_TBDIETAS', cod, 'excluido');
      await executar(e, 'pep.incluirCaracteristicaDaDieta', valores);
      const novo = (await itemDoDominio(e, CARACTERISTICA_DIETA, cod))!;
      const alterar = await codigoDa(
        executar(e, 'pep.alterarCaracteristicaDaDieta', {
          codigo: cod,
          versao: novo.versao,
          valores: { ordem: '3' },
        }),
      );
      return {
        inativoAntes: inativo.ativo,
        marcaAntes,
        marcaDepois,
        inativoNoEvento:
          (ev?.valorAnterior as { inativoSoNoNovo?: unknown } | null)?.inativoSoNoNovo !== undefined,
        novoAtivo: novo.ativo,
        alterar: alterar.codigo,
      };
    });
    expect(r).toEqual({
      inativoAntes: false,
      marcaAntes: 1,
      marcaDepois: 0,
      inativoNoEvento: true,
      novoAtivo: true,
      alterar: 'gravou',
    });
    expect(await retrato()).toEqual(antes);
    console.log(
      `[${a.cod}] W0-02 revisão: marca só no novo ${r.marcaAntes} → ${r.marcaDepois} na exclusão; o par incluído de novo nasce ativo (${r.novoAtivo}) e altera (${r.alterar})`,
    );
  });

  it('11: o evento da alteração (texto longo anterior) e da inativação (motivo)', async () => {
    const antes = await retrato();
    const carac = declaracao('pep.caracteristicaDieta')!;
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const inc = await executar(e, 'pep.incluirCaracteristicaDieta', {
        descricao: `W002 REVISAO ${Date.now() % 1e6}`,
        tipoResposta: 1,
        possiveisRespostas: 'Sim\nNão\nParcial',
      });
      const cod = String(inc.resultado['codigo']);
      const naInclusao = new TextDecoder('windows-1252').decode(await respostasDaCaracteristica(e, cod));
      const v1 = (await itemDoDominio(e, carac, cod))!.versao;
      await executar(e, 'pep.alterarCaracteristicaDieta', {
        codigo: cod,
        versao: v1,
        valores: { possiveisRespostas: null },
      });
      const alterado = await ultimoEvento(e, a.cod, 'PRCARACTDIE', cod, 'alterado');
      const v2 = (await itemDoDominio(e, carac, cod))!.versao;
      await executar(e, 'pep.inativarCaracteristicaDieta', {
        codigo: cod,
        versao: v2,
        motivo: 'não é mais oferecida (teste W0-02)',
      });
      const inativado = await ultimoEvento(e, a.cod, 'PRCARACTDIE', cod, 'inativado');
      return {
        naInclusao,
        anterior: alterado?.valorAnterior?.['possiveisRespostas'],
        motivoInativacao: inativado?.motivo,
        ativoAntes: inativado?.valorAnterior?.['ativo'],
      };
    });
    expect(r).toEqual({
      naInclusao: 'Sim\nNão\nParcial',
      anterior: 'Sim\nNão\nParcial',
      motivoInativacao: 'não é mais oferecida (teste W0-02)',
      ativoAntes: true,
    });
    expect(await retrato()).toEqual(antes);
    console.log(
      `[${a.cod}] W0-02 revisão: inclusão com o texto longo; evento "alterado" com o texto anterior (${JSON.stringify(r.anterior)}); evento "inativado" com o motivo`,
    );
  });

  it('12: a vigia não chama de "feita fora" a exclusão do Sante cujo evento é anterior à leitura', async () => {
    const antes = await retrato();
    const d = declaracao('internacao.tipoLimpeza')!;
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      await ligarVigiaNaTransacao(e, a.nucleo.rede, a.cod);
      const i = await executar(e, 'internacao.incluirTipoLimpeza', {
        nome: `VIGIA CORRIDA W002 ${Date.now() % 1e6}`,
        tempoPrevisto: '00:10',
      });
      const cod = String(i.resultado['codigo']);
      // O Sante grava o evento da exclusão (a transação dele ainda aberta: a linha continua visível) ...
      await registrarExclusaoPeloSante(e, a.cod, 'CHTPLIMPEZA', cod);
      // ... a vigia lê a tabela (a chave entra no retrato) ...
      const base = await rodarVigia(e, a.cod, [d]);
      // ... e a exclusão do Sante se confirma depois da leitura.
      await excluirTipoLimpezaPorFora(e, cod);
      const depois = await rodarVigia(e, a.cod, [d]);
      return { base: base.ligada, achados: depois.achados.filter((x) => x.foraDoSante.includes(cod)).length };
    });
    expect(r).toEqual({ base: true, achados: 0 });
    expect(await retrato()).toEqual(antes);
    console.log(
      `[${a.cod}] W0-02 revisão: vigia — exclusão do Sante com evento anterior ao retrato: ${r.achados} achado`,
    );
  });
});
