// F3.4 (04-INT linha 69): contrato de efeito dos documentos da internação pela regra de convênio, especialidade e
// modalidade, contra o MariaDB real (cliente da massa, marca D, massa SINTÉTICA). Grava o modelo e as regras (linha na
// trilha na mesma transação), recusa o código e a regra repetidos e a versão velha, e a escolha para a internação real
// segue a regra mais específica (cópias e obrigatoriedade dela); o modelo desativado deixa de sair e continua no banco
// (nada se apaga). A ficha da internação (porta.fichas) devolve os mesmos documentos com o texto. O outro estabelecimento
// não vê nem altera o modelo e as regras deste; o modelo comum só é mexido pela plataforma e não troca de dono; a regra
// sem momento e sem cópias herda as do modelo; o modelo sob demanda é oferecido na emissão. A emissão pela rota (POST
// /api/internacoes/:reg/impressos?momento=) grava a linha na trilha com o modelo, o momento e as cópias da regra, e o
// obrigatório já emitido volta lido da trilha (qualquer estação). SGH_NUCLEO_SEM_BANCO=1 pula.
import { criarAbility, regrasDeAcesso } from '@sgh/dominio-acesso';
import { ErroOperacao } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PortaDocumentosInternacao,
  esquemaModeloDocumento,
  esquemaRegraDocumento,
  textoDoModelo,
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
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RegistradorTrilhaPropria } from '../../autorizacao/trilha-propria.js';
import type { FonteConfiguracao } from '../config/configuracao-fonte.js';
import type { FonteDocumento } from '../documento/fonte.js';
import { desligarMapaEstabelecimentos, ligarMapaEstabelecimentos } from '../cadastro/contexto-nucleo.js';
import { CHAVE_ADT } from './apoios.js';
import { InternacaoController } from './internacao.controller.js';
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
        // Só as regras dos modelos deste teste (outra fatia pode usar o mesmo cliente ao mesmo tempo).
        await e.executar(
          `DELETE r FROM regra_documento_internacao r JOIN modelo_documento_internacao m ON m.id = r.modelo_documento_internacao_id
            WHERE m.codigo LIKE ?`,
          [`${P}%`],
        );
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

    it('isola os estabelecimentos; o modelo comum só pela plataforma e sem troca de dono', async () => {
      const outro = contextoAdt(M(), M().outro);
      const proprio = await modelo('PROPRIO');
      const entrada = (codigo: string, extra: Record<string, unknown> = {}) =>
        esquemaModeloDocumento.parse({
          codigo: `${P}-${codigo}`,
          titulo: `Termo ${codigo}`,
          conteudo: '<p>Eu, {paciente}, no leito {leito}.</p>',
          ...extra,
        });
      // Sem a plataforma: o modelo comum é recusado.
      expect(
        await recusada(
          docs.salvarModelo(contextoAdt(M()), entrada('COMUM', { todosEstabelecimentos: true })),
        ),
      ).toBe('409:modelo-comum');
      const comum = await docs.salvarModelo(
        contextoAdt(M()),
        entrada('COMUM', { todosEstabelecimentos: true }),
        true,
      );
      expect(
        await lerAdt<{ e: number | null }>(
          M(),
          'SELECT estabelecimento_id AS e FROM modelo_documento_internacao WHERE id = ?',
          [comum.id],
        ),
      ).toEqual({ e: null });
      // O outro estabelecimento vê o comum, não vê o deste, não altera o deste nem liga regra a ele.
      const vistos = (await docs.listar(outro)).modelos.map((x) => x.id);
      expect([vistos.includes(comum.id), vistos.includes(proprio.id)]).toEqual([true, false]);
      expect(
        await recusada(
          docs.salvarModelo(outro, entrada('PROPRIO', { id: proprio.id, versao: 1, titulo: 'Tomado' })),
        ),
      ).toBe('409:nao-encontrado');
      expect(
        await recusada(docs.salvarRegra(outro, esquemaRegraDocumento.parse({ modelo: proprio.id }))),
      ).toBe('409:modelo-inexistente');
      // Alterar o comum: só a plataforma, e ele não vira de um estabelecimento só.
      expect(
        await recusada(
          docs.salvarModelo(
            contextoAdt(M()),
            entrada('COMUM', { id: comum.id, versao: 1, todosEstabelecimentos: true }),
          ),
        ),
      ).toBe('409:modelo-comum');
      expect(
        await recusada(
          docs.salvarModelo(contextoAdt(M()), entrada('COMUM', { id: comum.id, versao: 1 }), true),
        ),
      ).toBe('409:troca-de-dono');
      expect(
        await recusada(
          docs.salvarModelo(
            contextoAdt(M()),
            entrada('PROPRIO', { id: proprio.id, versao: 1, todosEstabelecimentos: true }),
            true,
          ),
        ),
      ).toBe('409:troca-de-dono');
      // Marcador fora da lista fechada: recusado na hora.
      expect(
        await recusada(docs.salvarModelo(contextoAdt(M()), entrada('MARCA', { conteudo: '{senha}' }))),
      ).toBe('400:entrada-invalida');
      // O comum segue visível e com o mesmo dono para o outro estabelecimento, que liga a regra dele ao comum.
      const regraOutro = await docs.salvarRegra(outro, esquemaRegraDocumento.parse({ modelo: comum.id }));
      expect((await docs.listar(outro)).regras.map((x) => x.id)).toContain(regraOutro.id);
      expect((await docs.listar(contextoAdt(M()))).regras.map((x) => x.id)).not.toContain(regraOutro.id);
    }, 120_000);

    it('regra pela modalidade; momento e cópias do modelo; sob demanda e alta na ficha de impressos', async () => {
      const mod = await modelo('MODAL');
      const geral = await regra(mod.id, { ordem: 5 });
      const pelaModalidade = await regra(mod.id, { modalidade: M().modalidade, copias: 4, ordem: 5 });
      expect(
        (await docs.documentos(contextoAdt(M()), internacao, 'admissao'))?.find((d) => d.modelo === mod.id)
          ?.regra,
      ).toBe(pelaModalidade.id);
      expect(geral.id).toBeLessThan(pelaModalidade.id);

      // Regra sem momento e sem cópias: herda as do modelo (alta, 2 cópias).
      const deAlta = await modelo('ALTA', { momento: 'alta', copias: 2 });
      const r = await regra(deAlta.id, { obrigatorio: true });
      expect(
        await lerAdt<{ momento: string; copias: number }>(
          M(),
          'SELECT momento, copias FROM regra_documento_internacao WHERE id = ?',
          [r.id],
        ),
      ).toMatchObject({ momento: 'alta', copias: 2 });
      const sob = await modelo('SOB', {
        momento: 'sob_demanda',
        copias: 3,
        conteudo: '<p>Termo de {paciente}</p>',
      });

      const alta = await adt.fichas(contextoAdt(M()), internacao, 'alta');
      expect(alta.filter((f) => f.modelo === deAlta.id).map((f) => [f.copias, f.obrigatorio])).toEqual([
        [2, true],
      ]);
      expect(alta.find((f) => f.modelo === sob.id)).toMatchObject({
        copias: 3,
        sobDemanda: true,
        selecionado: false,
      });
      const admissao = await adt.fichas(contextoAdt(M()), internacao, 'admissao');
      expect(admissao.some((f) => f.modelo === deAlta.id)).toBe(false);
      expect(admissao.find((f) => f.modelo === sob.id)?.texto).toBe('Termo de {paciente}');
    }, 120_000);

    it('emissão pela rota: PDF com os campos preenchidos, trilha com modelo, momento e cópias; pendente pela trilha', async () => {
      const mod = await modelo('EMIT', {
        momento: 'admissao',
        conteudo: '<p>Termo de <strong>{paciente}</strong> no leito {leito}</p>',
      });
      await regra(mod.id, { obrigatorio: true, copias: 2 });
      desligarMapaEstabelecimentos();
      await ligarMapaEstabelecimentos(CLIENTE_ADT, M().nucleo);
      type Pedido = {
        modelo: string;
        copias?: number;
        campos: { rotulo: string; valor: string; formato?: string }[];
      };
      const emitidos: Pedido[] = [];
      const documento = {
        emissao: {
          emitir: async (p: Pedido) => {
            emitidos.push(p);
            return { pdf: new Uint8Array([37, 80, 68, 70]) };
          },
        },
      } as unknown as FonteDocumento;
      const configuracao = {
        chaves: async () => [
          { chave: CHAVE_ADT, tipo: 'recurso', ligada: true, escopo: 'hospital', valor: '*' },
        ],
        prerequisitos: async () => [
          { recurso: CHAVE_ADT, tipo: 'aprovacao', situacao: 'cumprido', validade: null },
        ],
        parametros: async () => [],
      } as unknown as FonteConfiguracao;
      const ctrl = new InternacaoController(
        adt,
        new RegistradorTrilhaPropria(M().nucleo, CLIENTE_ADT),
        configuracao,
        null,
        null,
        documento,
      );
      const PERMS = ['internacao.impresso.emitir'];
      const req = () =>
        ({
          headers: {
            'idempotency-key': `int-doc-emit-${internacao}-${Date.now()}`,
            'x-correlation-id': 'int-doc-emit',
          },
          ip: '127.0.0.1',
          sgh: {
            real: false,
            ability: criarAbility(regrasDeAcesso([...PERMS], null)),
            sessao: {
              usuario: { id: String(M().usuario), nome: 'Conta sintética', login: M().login },
              rede: 'teste',
              estabelecimentos: [],
              estabelecimentoAtivo: `L0301${M().marca}`,
              unidadeAtiva: null,
              permissoes: [...PERMS],
              sintetica: true,
              bloqueioInatividadeSegundos: 0,
              expiraEm: '',
            },
          },
        }) as unknown as RequisicaoAutorizada;
      const linhas = () =>
        M().nucleo.lerSomente({ cliente: CLIENTE_ADT, correlacao: 'int-doc-emit-conferir' }, (l) =>
          l.consultar(
            `SELECT estabelecimento_id, usuario_id, JSON_UNQUOTE(JSON_EXTRACT(dados_depois, '$.chaveNatural')) AS chave,
                    JSON_UNQUOTE(JSON_EXTRACT(dados_depois, '$.evento')) AS evento
               FROM trilha_auditoria WHERE entidade = 'internacao' AND entidade_id = ?
                AND JSON_UNQUOTE(JSON_EXTRACT(dados_depois, '$.chaveNatural')) LIKE ? ORDER BY id`,
            [internacao, `ficha-${mod.id}:%`],
          ),
        );

      const antes = (await ctrl.fichas(String(internacao), 'admissao', req())).fichas.find(
        (f) => f.modelo === mod.id,
      );
      expect(antes).toMatchObject({ obrigatorio: true, copias: 2 });
      expect(antes?.emitidoEm).toBeUndefined();
      expect(await linhas()).toEqual([]);

      // As cópias digitadas (9) não valem: saem as da regra (2), que entram na chave da trilha.
      const r = await ctrl.impresso(
        String(internacao),
        { impresso: 'ficha', formato: 'pdf', copias: 9, modelo: mod.id },
        req(),
        'admissao',
      );
      expect(r).toMatchObject({ formato: 'pdf', nomeArquivo: `ficha-${mod.id}-${internacao}.pdf` });
      expect(emitidos.at(-1)?.modelo).toBe(`internacao-ficha-${mod.id}`);
      const campo = emitidos.at(-1)?.campos.find((c) => c.rotulo === 'Documento');
      const texto = campo?.valor ?? '';
      // O negrito do editor chega marcado (o PDF o leva) e as 2 cópias da regra saem dentro do mesmo PDF.
      expect(texto).toMatch(/^Termo de \*\*[^*]+\*\* no leito .+$/);
      expect(campo?.formato).toBe('marcado');
      expect(emitidos.at(-1)?.copias).toBe(2);
      expect(textoDoModelo('<p>A <b class="x">B</b><strong></strong></p><p>C<br>D</p>')).toBe(
        'A **B**\nC\nD',
      );
      expect(texto).not.toMatch(/\{(paciente|leito)\}/);
      const gravadas = await linhas();
      expect(gravadas).toHaveLength(1);
      expect(gravadas[0]).toMatchObject({
        estabelecimento_id: M().est,
        usuario_id: M().usuario,
        evento: 'internacao.impresso.emitido',
      });
      expect(String(gravadas[0]!['chave'])).toMatch(new RegExp(`^ficha-${mod.id}:admissao:2:[0-9a-f]{16}$`));

      // O obrigatório já emitido volta lido da trilha (outra estação ou sessão); em outro momento, não.
      const depois = (await ctrl.fichas(String(internacao), 'admissao', req())).fichas.find(
        (f) => f.modelo === mod.id,
      );
      expect(depois?.emitidoEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      const alta = await ctrl.fichas(String(internacao), 'alta', req());
      expect(alta.fichas.find((f) => f.modelo === mod.id)?.emitidoEm).toBeUndefined();

      // Modelo fora da configuração desta internação: 409 e nada na trilha.
      await expect(
        ctrl.impresso(
          String(internacao),
          { impresso: 'ficha', formato: 'pdf', copias: 1, modelo: 32_767 },
          req(),
          'admissao',
        ),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        ctrl.impresso(
          String(internacao),
          { impresso: 'ficha', formato: 'pdf', copias: 1, modelo: mod.id },
          req(),
          'transferencia',
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(await linhas()).toHaveLength(1);
      desligarMapaEstabelecimentos();
    }, 120_000);
  },
);
