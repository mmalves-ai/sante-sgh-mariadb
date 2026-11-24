// F3.4 (04-INT linha 69): contrato de efeito dos documentos da internação pela regra de convênio, especialidade e
// modalidade, contra o MariaDB real (cliente da massa, marca D, massa SINTÉTICA). Grava o modelo e as regras (linha na
// trilha na mesma transação), recusa o código e a regra repetidos e a versão velha, e a escolha para a internação real
// segue a regra mais específica (cópias e obrigatoriedade dela); o modelo desativado deixa de sair e continua no banco
// (nada se apaga). A ficha da internação (porta.fichas) devolve os mesmos documentos com o texto. SGH_NUCLEO_SEM_BANCO=1
// pula.
import { ErroOperacao } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PortaDocumentosInternacao,
  esquemaModeloDocumento,
  esquemaRegraDocumento,
} from './documentos-internacao.js';
import {
  CLIENTE_ADT,
  contextoAdt,
  encerrarMassaAdt,
  lerAdt,
  type MassaAdt,
  operacaoAdt,
  prepararMassaAdt,
  SEM_BANCO_ADT,
} from './massa-adt.spec-util.js';
import { PortaAdtPropria } from './porta-propria.js';

const P = 'L0301D';

describe.skipIf(SEM_BANCO_ADT)(
  `documentos da internação pela regra (MariaDB, cliente ${CLIENTE_ADT})`,
  () => {
    let m: MassaAdt | null = null;
    let docs: PortaDocumentosInternacao;
    let adt: PortaAdtPropria;
    let internacao = 0;
    const M = () => m!;
    const limpar = () =>
      M().nucleo.escrever({ cliente: CLIENTE_ADT, correlacao: 'int-doc-internacao-limpeza' }, async (e) => {
        await e.executar('DELETE FROM regra_documento_internacao WHERE estabelecimento_id IN (?, ?)', [
          M().est,
          M().outro,
        ]);
        await e.executar('DELETE FROM modelo_documento_internacao WHERE codigo LIKE ?', [`${P}%`]);
      });
    const recusada = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (x) {
        return x instanceof ErroOperacao ? `${x.problema.status}:${String(x.problema.codigo)}` : String(x);
      }
      return 'aceita';
    };
    const modelo = (codigo: string, extra: Record<string, unknown> = {}) =>
      docs.salvarModelo(
        contextoAdt(M()),
        esquemaModeloDocumento.parse({
          codigo: `${P}-${codigo}`,
          titulo: `Termo ${codigo}`,
          conteudo: `<p>Texto ${codigo}</p>`,
          ...extra,
        }),
      );
    const regra = (mod: number, extra: Record<string, unknown> = {}) =>
      docs.salvarRegra(contextoAdt(M()), esquemaRegraDocumento.parse({ modelo: mod, ...extra }));

    beforeAll(async () => {
      m = await prepararMassaAdt('D');
      docs = new PortaDocumentosInternacao(M().nucleo);
      adt = new PortaAdtPropria(M().nucleo);
      await limpar();
      const r = await adt.executar(
        contextoAdt(M()),
        'internacao.internar',
        {
          paciente: M().pacientes[0],
          leito: { bloco: 'B1', acomodacao: 'Q1', leito: '01' },
          convenio: M().convenio,
          acomodacaoPlano: 'ENFERMARIA',
          carater: 'urgencia',
          clinica: 'M',
          especialidade: M().especialidade,
          medicoAssistente: M().medico,
          medicoSolicitante: M().medico,
          cidPrincipal: M().cid,
          procedimento: M().procedimento,
          procedimentoOrigem: 'sigtap',
          centroCusto: 1,
          unidade: 1,
          origem: 'ambulatorio',
          caraterAdmissao: M().carater,
          caraterTiss: M().caraterTiss,
          categoriaAtendimento: M().categoria,
          modalidade: M().modalidade,
        },
        { ...operacaoAdt(M()), reautenticadoEm: Date.now() },
      );
      internacao = Number((r.resultado as Record<string, unknown>)['internacao']);
    }, 120_000);

    afterAll(async () => {
      if (m) await limpar().catch(() => undefined);
      await encerrarMassaAdt(m);
    });

    it('grava modelo e regras com a trilha; escolhe pela regra mais específica; nada se apaga', async () => {
      const geral = await modelo('GERAL');
      const convenio = await modelo('CONV', { copias: 2 });
      const foraDaIdade = await modelo('IDOSO', { idadeMinima: 140, idadeMaxima: 150 });
      expect(await recusada(modelo('GERAL'))).toBe('409:codigo-repetido');

      const linha = await lerAdt<{ estabelecimento_id: number; formato: string; versao: number }>(
        M(),
        'SELECT estabelecimento_id, formato, versao FROM modelo_documento_internacao WHERE id = ?',
        [geral.id],
      );
      expect(linha).toMatchObject({ estabelecimento_id: M().est, formato: 'html', versao: 1 });
      const trilha = await lerAdt<{ n: number }>(
        M(),
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'modelo_documento_internacao' AND entidade_id = ?",
        [geral.id],
      );
      expect(Number(trilha?.n)).toBeGreaterThanOrEqual(1);

      await regra(geral.id, { ordem: 2 });
      const geralConv = await regra(convenio.id, { copias: 1, ordem: 1 });
      const especifica = await regra(convenio.id, {
        convenio: M().convenio,
        especialidade: M().especialidade,
        copias: 3,
        obrigatorio: true,
        ordem: 1,
      });
      await regra(foraDaIdade.id);
      expect(await recusada(regra(geral.id, { ordem: 9 }))).toBe('409:regra-repetida');

      const saida = await docs.documentos(contextoAdt(M()), internacao, 'admissao');
      expect(saida?.map((d) => [d.modelo, d.regra, d.copias, d.obrigatorio, d.selecionado])).toEqual([
        [convenio.id, especifica.id, 3, true, true],
        [geral.id, expect.any(Number), 1, false, true],
      ]);
      expect(saida?.[0]?.texto).toBe('Texto CONV');
      expect(await docs.documentos(contextoAdt(M()), internacao, 'alta')).toEqual([]);

      // A ficha da internação devolve os mesmos documentos, com o texto para a emissão.
      const fichas = await adt.fichas(contextoAdt(M()), internacao);
      expect(fichas.map((f) => [f.modelo, f.copias, f.texto])).toEqual([
        [convenio.id, 3, 'Texto CONV'],
        [geral.id, 1, 'Texto GERAL'],
      ]);

      // Versão velha: conflito; desativar a regra específica volta à geral do modelo (a regra continua no banco).
      expect(
        await recusada(
          docs.salvarRegra(
            contextoAdt(M()),
            esquemaRegraDocumento.parse({
              id: especifica.id,
              versao: 99,
              modelo: convenio.id,
              convenio: M().convenio,
            }),
          ),
        ),
      ).toMatch(/^409:/);
      await docs.salvarRegra(
        contextoAdt(M()),
        esquemaRegraDocumento.parse({
          id: especifica.id,
          versao: 1,
          modelo: convenio.id,
          convenio: M().convenio,
          especialidade: M().especialidade,
          copias: 3,
          obrigatorio: true,
          ordem: 1,
          ativo: false,
        }),
      );
      const depois = await docs.documentos(contextoAdt(M()), internacao, 'admissao');
      expect(depois?.find((d) => d.modelo === convenio.id)?.regra).toBe(geralConv.id);

      // Modelo desativado: sai da escolha e continua no banco.
      await docs.salvarModelo(
        contextoAdt(M()),
        esquemaModeloDocumento.parse({
          id: geral.id,
          versao: 1,
          codigo: `${P}-GERAL`,
          titulo: 'Termo GERAL',
          conteudo: '<p>Texto GERAL</p>',
          ativo: false,
        }),
      );
      expect((await docs.documentos(contextoAdt(M()), internacao, 'admissao'))?.map((d) => d.modelo)).toEqual(
        [convenio.id],
      );
      const contagem = await lerAdt<{ modelos: number; regras: number }>(
        M(),
        `SELECT (SELECT COUNT(*) FROM modelo_documento_internacao WHERE codigo LIKE ?) AS modelos,
              (SELECT COUNT(*) FROM regra_documento_internacao WHERE estabelecimento_id = ?) AS regras`,
        [`${P}%`, M().est],
      );
      expect([Number(contagem?.modelos), Number(contagem?.regras)]).toEqual([3, 4]);

      // Validação na hora: faixa de idade invertida recusada com o campo.
      expect(await recusada(modelo('IDADE', { idadeMinima: 18, idadeMaxima: 10 }))).toBe(
        '400:entrada-invalida',
      );
      // Regra de modelo de outro estabelecimento ou inexistente: recusada.
      expect(await recusada(regra(999_999_999))).toBe('409:modelo-inexistente');
    }, 120_000);
  },
);
