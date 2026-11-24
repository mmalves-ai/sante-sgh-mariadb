// Unidade das leituras de catálogo e regra da prescrição no banco próprio, com dublê do Leitor: o cliente vem da
// configuração quando a sessão não traz, toda leitura passa pelo estabelecimento da sessão, o SQL é parametrizado e a
// forma de retorno é a da porta de memória (especificação).
import type { Leitor, Linha } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import { PortaPrescricaoMemoria } from './prescricao-porta-memoria.js';
import {
  CatalogoPrescricaoPropria,
  instanteDoCivil,
  PARAMETROS_PRESCRICAO_PADRAO,
  TETO_CADASTRO,
} from './prescricao-propria-catalogo.js';
import type { NucleoLeituraPep } from './registro-porta-propria.js';

interface Chamada {
  readonly sql: string;
  readonly parametros: readonly unknown[];
}

const EST = { id: 7, fuso_horario: 'America/Sao_Paulo' };

function duble(respostas: (sql: string) => Linha[]) {
  const chamadas: Chamada[] = [];
  const contextos: { cliente: string; correlacao: string }[] = [];
  const resp = (sql: string) => (/FROM estabelecimento WHERE codigo/.test(sql) ? [EST] : respostas(sql));
  const leitor: Leitor = {
    cliente: 'x',
    async consultar<T extends Linha = Linha>(sql: string, parametros: readonly unknown[] = []) {
      chamadas.push({ sql, parametros });
      return resp(sql) as T[];
    },
    async uma<T extends Linha = Linha>(sql: string, parametros: readonly unknown[] = []) {
      chamadas.push({ sql, parametros });
      return (resp(sql)[0] as T | undefined) ?? null;
    },
  };
  const nucleo: NucleoLeituraPep = {
    lerSomente: async (contexto, fn) => {
      contextos.push({ ...contexto });
      return fn(leitor);
    },
  };
  return { cat: new CatalogoPrescricaoPropria(nucleo, 'cliente-config'), chamadas, contextos };
}

const C = { rede: 'r', hospital: 'h1', cliente: '', estabelecimento: 7, usuario: null, correlacao: 't' };
const MEM = new PortaPrescricaoMemoria();

describe('CatalogoPrescricaoPropria (dublê)', () => {
  it('estabelecimento inexistente: 404; cliente da configuração quando a sessão não traz', async () => {
    const chamadas: string[] = [];
    const nucleo: NucleoLeituraPep = {
      lerSomente: async (ctx, fn) => {
        chamadas.push(ctx.cliente);
        return fn({ cliente: 'x', consultar: async () => [], uma: async () => null } as unknown as Leitor);
      },
    };
    await expect(new CatalogoPrescricaoPropria(nucleo, 'cfg').relativos(C)).rejects.toMatchObject({
      problema: { status: 404 },
    });
    expect(chamadas).toEqual(['cfg']);
  });

  it('regras: tipo I/E, horário HHMM, considerar pela vigência, grade da regra sobre a geral, bloco e unidade', async () => {
    const { cat, chamadas } = duble((sql) =>
      /FROM grade_horario_unidade/.test(sql)
        ? [
            {
              id: 4,
              tipo_atendimento: 'internacao',
              hora_inicio_dia: '16:01:00',
              considera_vigencia: 1,
              padrao: 1,
              unidade_internacao_id: 9,
              bloco_internacao_id: 3,
              setor_funcional_id: null,
              unidade_assistencial_id: 19,
            },
            {
              id: 5,
              tipo_atendimento: 'urgencia',
              hora_inicio_dia: '00:00:00',
              considera_vigencia: 0,
              padrao: 1,
              unidade_internacao_id: null,
              bloco_internacao_id: null,
              setor_funcional_id: null,
              unidade_assistencial_id: null,
            },
            {
              id: 6,
              tipo_atendimento: 'urgencia',
              hora_inicio_dia: '07:00:00',
              considera_vigencia: 1,
              padrao: 1,
              unidade_internacao_id: null,
              bloco_internacao_id: null,
              setor_funcional_id: 2,
              unidade_assistencial_id: null,
            },
          ]
        : /FROM horario_padrao_dose/.test(sql)
          ? [
              { grade_horario_unidade_id: null, doses_por_dia: 1, horario: '22:00:00' },
              { grade_horario_unidade_id: null, doses_por_dia: 2, horario: '22:00:00' },
              { grade_horario_unidade_id: null, doses_por_dia: 2, horario: '10:00:00' },
              { grade_horario_unidade_id: 4, doses_por_dia: 1, horario: '08:00:00' },
            ]
          : [],
    );
    const r = await cat.regras(C);
    expect(r.regras.map((x) => ({ ...x, grade: undefined }))).toEqual([
      // Grade de unidade/bloco (4) ou de setor (6) marcada como padrão não é padrão do estabelecimento.
      { id: 4, tipoAtendimento: 'I', horarioInicial: '1601', considerar: 0, padrao: false },
      { id: 5, tipoAtendimento: 'E', horarioInicial: '0000', considerar: 3, padrao: true },
      { id: 6, tipoAtendimento: 'E', horarioInicial: '0700', considerar: 0, padrao: false },
    ]);
    expect([...r.regras[0]!.grade]).toEqual([
      [1, ['0800']],
      [2, ['2200', '1000']],
    ]);
    expect([...r.regras[1]!.grade]).toEqual([
      [1, ['2200']],
      [2, ['2200', '1000']],
    ]);
    expect([...r.porBloco]).toEqual([['3', 4]]);
    // porUnidade pela unidade assistencial (a que o atendimento devolve), não pelo id da unidade de internação.
    expect([...r.porUnidade]).toEqual([[19, 4]]);
    expect(
      chamadas.filter((c) => /grade_horario|horario_padrao/.test(c.sql)).every((c) => c.parametros[0] === 7),
    ).toBe(true);
    // A forma é a da memória.
    const m = await MEM.regras();
    expect(Object.keys(r).sort()).toEqual(Object.keys(m).sort());
  });

  it('relativos e horários de dieta em HHMM; dieta agrupa por modalidade', async () => {
    const { cat } = duble((sql) =>
      /frequencia_horario_relativo/.test(sql)
        ? [{ id: 1, descricao: 'Café da manhã', horario_referencia: '07:00:00' }]
        : /modalidade_dieta_refeicao/.test(sql)
          ? [
              { modalidade_dieta_id: 2, horario_inicio: '07:00:00' },
              { modalidade_dieta_id: 2, horario_inicio: '11:45:00' },
              { modalidade_dieta_id: 3, horario_inicio: '18:00:00' },
            ]
          : [],
    );
    expect(await cat.relativos(C)).toEqual([{ id: 1, nome: 'Café da manhã', horario: '0700' }]);
    expect([...(await cat.horariosDieta(C))]).toEqual([
      [2, ['0700', '1145']],
      [3, ['1800']],
    ]);
  });

  it('domínios: as mesmas chaves da memória; via e unidade pela sigla', async () => {
    const { cat } = duble((sql) =>
      /FROM via_de_uso/.test(sql)
        ? [{ id: 'EV', nome: 'Endovenosa' }]
        : /FROM modalidade_dieta/.test(sql)
          ? [{ id: 5, nome: 'Dieta geral', grupo: 'oral' }]
          : [],
    );
    const d = await cat.dominios(C);
    expect(Object.keys(d).sort()).toEqual(Object.keys(await MEM.dominios()).sort());
    expect(d['vias']).toEqual([{ id: 'EV', nome: 'Endovenosa' }]);
    expect(d['dietas']).toEqual([{ id: '5', nome: 'Dieta geral', grupo: 'oral' }]);
  });

  it('produtos: sem ids não lê; princípios, vias sem repetir, portaria da lista, faixas e forma da memória', async () => {
    const vazio = duble(() => []);
    expect(await vazio.cat.produtos(C, [])).toEqual([]);
    expect(vazio.chamadas).toEqual([]);
    const { cat, chamadas } = duble((sql) =>
      /FROM item_prescritivel ip\s+JOIN tipo_item_prescricao/.test(sql) && /ip.alta_vigilancia/.test(sql)
        ? [
            {
              id: 503,
              descricao: 'MORFINA 10 MG/ML',
              unidade: 'MG',
              padronizado: 1,
              controlado: 0,
              antimicrobiano: 0,
              alta_vigilancia: 1,
              validade_horas: null,
              principio_ativo_id: 13,
              insumo_id: 1,
              via_padrao: 'EV',
            },
          ]
        : /JOIN principio_ativo pa/.test(sql)
          ? [{ item: 503, id: 13, descricao: 'MORFINA', codigo_lista: 'A1' }]
          : /FROM item_prescritivel_via/.test(sql)
            ? [
                { item: 503, via: 'EV' },
                { item: 503, via: 'SC' },
              ]
            : /limite_dose_principio/.test(sql)
              ? [{ item: 503, unidade: 'MG', dose_minima_alerta: '1.0000', dose_maxima_alerta: '10.0000' }]
              : [],
    );
    const [p] = await cat.produtos(C, [503, 503]);
    expect(p).toEqual({
      produto: 503,
      nome: 'MORFINA 10 MG/ML',
      unidade: 'MG',
      padronizado: true,
      psicotropico: true,
      portaria: 'A1',
      antimicrobiano: false,
      principios: [{ id: 13, nome: 'MORFINA' }],
      vias: ['EV', 'SC'],
      potencialmentePerigoso: true,
      periodoMinimoHoras: null,
      faixasDose: [{ unidade: 'MG', minima: 1, maxima: 10 }],
    });
    const memoria = (await MEM.produtos(C, [503]))[0]!;
    expect(Object.keys(p!).sort()).toEqual(Object.keys(memoria).sort());
    expect(chamadas.find((c) => /limite_dose_principio/.test(c.sql))?.parametros).toEqual([503, 7]);
    // Índice: mesma forma do item do índice da memória (sem vias nem período mínimo).
    const [i] = await cat.itensParaIndice(C);
    expect(Object.keys(i!).sort()).toEqual(Object.keys((await MEM.itensParaIndice())[0]!).sort());
  });

  it('kits: faixa, unidade, via, atendimento (todos = null; internação = I) e componentes sem o principal', async () => {
    const { cat } = duble((sql) =>
      /FROM kit_prescricao k/.test(sql)
        ? [
            {
              id: 1,
              item_prescritivel_id: 502,
              intervalo_dose_inicial: null,
              intervalo_dose_final: null,
              tipo_atendimento: 'todos',
              unidade: 'G',
              via: 'EV',
            },
            {
              id: 2,
              item_prescritivel_id: 502,
              intervalo_dose_inicial: '1',
              intervalo_dose_final: '2',
              tipo_atendimento: 'internacao',
              unidade: 'G',
              via: 'EV',
            },
          ]
        : /FROM kit_prescricao_item/.test(sql)
          ? [{ kit_prescricao_id: 1, item_prescritivel_id: 601, quantidade: '1.0000', unidade: 'UN' }]
          : [],
    );
    expect(await cat.kits(C, 502)).toEqual([
      {
        id: 1,
        produto: 502,
        doseDe: 0,
        doseAte: 0,
        unidade: 'G',
        via: 'EV',
        tipoAtendimento: null,
        itens: [{ produto: 601, quantidade: 1, unidade: 'UN' }],
      },
      {
        id: 2,
        produto: 502,
        doseDe: 1,
        doseAte: 2,
        unidade: 'G',
        via: 'EV',
        tipoAtendimento: 'I',
        itens: [],
      },
    ]);
  });

  it('cadastro: parâmetros do item pedem 2 letras sem ler; termo escapado; teto marca truncada', async () => {
    const curto = duble(() => []);
    expect(await curto.cat.cadastro(C, 'parametrosItem', 'a')).toEqual({ linhas: [], truncada: false });
    expect(curto.chamadas).toEqual([]);
    const muitas = Array.from({ length: TETO_CADASTRO + 1 }, (_, k) => ({
      id: k + 1,
      nome: `R${k}`,
      ativo: 1,
      uso_geral: 1,
      inicio: '2026-01-05',
      fim: null,
    }));
    const { cat, chamadas } = duble((sql) => (/FROM protocolo_prescricao pp/.test(sql) ? muitas : []));
    const r = await cat.cadastro(C, 'receitasPadrao', '50%_x');
    expect(r.truncada).toBe(true);
    expect(r.linhas).toHaveLength(TETO_CADASTRO);
    expect(r.linhas[0]).toEqual({
      id: '1',
      nome: 'R0',
      ativo: true,
      campos: { geral: true, vigenteDesde: '2026-01-05', vigenteAte: null },
      filhos: [],
    });
    expect(chamadas.at(-1)?.parametros).toEqual([7, '%50\\%\\_x%']);
  });

  it('cadastro de kits: filhos do kit, principal marcado na solução e fora no kit de medicamento', async () => {
    const { cat } = duble((sql) =>
      /FROM kit_prescricao k/.test(sql)
        ? [
            {
              id: 1,
              nome: 'SORO',
              ativo: 1,
              frequencia: 'Contínuo',
              via: 'Endovenosa',
              iniciar_administracao_agora: 0,
              velocidade_infusao: '83.3330',
              infusao: 'Bomba',
              intervalo_dose_inicial: null,
              intervalo_dose_final: null,
              unidade: 'G',
              tipo_atendimento: 'todos',
            },
          ]
        : /FROM kit_prescricao_item/.test(sql)
          ? [
              { dono: 1, nome: 'SF 0,9%', quantidade: '1000', unidade: 'ML', papel: 'principal' },
              { dono: 1, nome: 'KCL', quantidade: '20', unidade: 'ML', papel: 'componente' },
            ]
          : [],
    );
    const s = await cat.cadastro(C, 'kitsSolucao', undefined);
    expect(s.linhas[0]?.campos).toEqual({
      frequencia: 'Contínuo',
      via: 'Endovenosa',
      agora: false,
      velocidade: 83.333,
      infusao: 'Bomba',
    });
    expect(s.linhas[0]?.filhos.map((f) => f.campos['principal'])).toEqual([true, false]);
    const m = await cat.cadastro(C, 'kitsMedicamento', undefined);
    expect(m.linhas[0]?.campos['atendimento']).toBe('A');
    expect(m.linhas[0]?.filhos.map((f) => f.nome)).toEqual(['KCL']);
  });

  it('protocolos: sexo, especialidades e itens; itens do protocolo como itens lidos sem horários', async () => {
    const { cat } = duble((sql) =>
      /FROM protocolo_prescricao pp\s+WHERE pp.tipo = 'protocolo'/.test(sql)
        ? [
            {
              id: 1,
              nome: 'ANALGESIA',
              ativo: 1,
              inicio: null,
              fim: null,
              idade_minima_anos: null,
              idade_maxima_anos: 12,
              peso_minimo_kg: null,
              peso_maximo_kg: '40.000',
              sexo: 'todos',
              itens: 2,
            },
          ]
        : /protocolo_prescricao_especialidade/.test(sql)
          ? [{ p: 1, e: 999 }]
          : /FROM protocolo_prescricao_item i/.test(sql)
            ? [
                {
                  id: 10,
                  protocolo_prescricao_id: 1,
                  tipo_item: 'medicamento',
                  item_prescritivel_id: 501,
                  quantidade: null,
                  dose_padrao: '500',
                  urgente: 0,
                  observacao: null,
                  frequencia_administracao_id: 3,
                  frequencia_nome: '8/8h',
                  doses_por_dia: 3,
                  via: 'EV',
                  unidade: 'MG',
                  produto_nome: 'DIPIRONA',
                  principio_ativo_id: 11,
                  tipo_id: 1,
                  categoria: 'medicamento',
                  tipo_nome: 'Medicamentos',
                },
                {
                  id: 11,
                  protocolo_prescricao_id: 1,
                  tipo_item: 'cuidado',
                  item_prescritivel_id: null,
                  quantidade: null,
                  dose_padrao: null,
                  urgente: 0,
                  observacao: 'Elevar cabeceira',
                  frequencia_administracao_id: null,
                  frequencia_nome: null,
                  doses_por_dia: null,
                  via: null,
                  unidade: null,
                  produto_nome: null,
                  principio_ativo_id: null,
                  tipo_id: null,
                  categoria: null,
                  tipo_nome: null,
                },
              ]
            : [],
    );
    const [p] = await cat.protocolos(C);
    expect(p).toEqual({
      id: 1,
      nome: 'ANALGESIA',
      ativo: true,
      vigenciaInicio: null,
      vigenciaFim: null,
      idadeMin: null,
      idadeMax: 12,
      pesoMin: null,
      pesoMax: 40,
      sexo: null,
      especialidades: [999],
      itens: 2,
    });
    expect(Object.keys(p!).sort()).toEqual(Object.keys((await MEM.protocolos())[0]!).sort());
    const itens = await cat.itensDoProtocolo(C, 1);
    expect(itens[0]).toMatchObject({
      id: 10,
      frequencia: 3,
      numDoses: 3,
      via: 'EV',
      horarios: [],
      detalhe: { tipo: 'medicamento', produto: 501, dose: 500, unidade: 'MG', principios: [11] },
    });
    expect(itens[1]).toMatchObject({
      id: 11,
      plano: 1000,
      observacaoEnfermagem: 'Elevar cabeceira',
      detalhe: { tipo: 'outro', id: null },
    });
  });

  it('especialidades do prescritor pelo login (duas vezes: do profissional e da ocupação)', async () => {
    const { cat, chamadas } = duble((sql) =>
      /profissional_especialidade/.test(sql) ? [{ e: 1 }, { e: 4 }] : [],
    );
    expect(await cat.especialidadesDoPrescritor(C, 'medico')).toEqual([1, 4]);
    expect(chamadas.at(-1)?.parametros).toEqual(['medico', 'medico']);
  });

  it('produtos ativos e dieta de outro: período em UTC, exceto parametrizado; dieta só de outro CBO', async () => {
    const { cat, chamadas } = duble((sql) =>
      /prescricao_item_medicamento m/.test(sql)
        ? [{ id: 5, produto: 501, categoria: 'medicamento', tipo_id: 1 }]
        : /t.categoria = 'dieta'/.test(sql)
          ? [
              { prescricao: 9, item: 90, codigo_cbo: '225125', autor: 'medico' },
              { prescricao: 8, item: 80, codigo_cbo: '223710', autor: 'nutri' },
            ]
          : [],
    );
    expect(await cat.produtosAtivos(C, 30, '2026-11-23T13:00', '2026-11-24T12:59', 4)).toEqual([
      { item: 5, produto: 501, plano: expect.any(Number) },
    ]);
    const p = chamadas.at(-1)!.parametros;
    expect(p.slice(0, 2)).toEqual([7, 30]);
    expect((p[2] as Date).toISOString()).toBe('2026-11-24T15:59:59.000Z');
    expect((p[3] as Date).toISOString()).toBe('2026-11-23T16:00:00.000Z');
    expect(p.slice(4)).toEqual([4, 4]);
    expect(await cat.dietaDeOutro(C, 30, '2026-11-23T13:00', '2026-11-24T12:59', 225125)).toEqual({
      autor: 'nutri',
      prescricao: 8,
      item: 80,
    });
    expect(await cat.dietaDeOutro(C, 30, '2026-11-23T13:00', '2026-11-24T12:59', 0)).toEqual({
      autor: 'medico',
      prescricao: 9,
      item: 90,
    });
  });

  it('parâmetros: sem definição, o padrão; valor do estabelecimento/rede ou padrão da definição', async () => {
    expect(await duble(() => []).cat.parametrosPrescricao(C)).toEqual(PARAMETROS_PRESCRICAO_PADRAO);
    const { cat } = duble((sql) =>
      /FROM parametro_definicao/.test(sql)
        ? [
            { chave: 'pep.prescricao.duplicidadePorMedicamento', valor_padrao: 'true', valor: 'false' },
            { chave: 'pep.prescricao.calcularVelocidade', valor_padrao: 'true', valor: null },
          ]
        : [],
    );
    expect(await cat.parametrosPrescricao(C)).toEqual({
      consistirDuplicidade: true,
      porMedicamento: false,
      porPrincipio: true,
      calcularVelocidade: true,
    });
  });

  it('regras de alerta: nível pelo bloqueio/justificativa, versão vigente, forma da memória', async () => {
    const { cat, chamadas } = duble((sql) =>
      /FROM regra_alerta r/.test(sql)
        ? [
            {
              id: 1,
              codigo: 'R1',
              tipo: 'interacao',
              bloqueante: 1,
              exige_justificativa: 1,
              numero_versao_vigente: 2,
              vigente_desde: '2026-11-01',
              ativa: 1,
              descricao: 'Bloqueia',
              autor: 'admin',
              criado_em: new Date('2026-11-01T12:00:00Z'),
            },
            {
              id: 2,
              codigo: 'R2',
              tipo: 'duplicidade',
              bloqueante: 0,
              exige_justificativa: 1,
              numero_versao_vigente: 1,
              vigente_desde: '2026-10-01',
              ativa: 0,
              descricao: 'Justifica',
              autor: '',
              criado_em: null,
            },
            {
              id: 3,
              codigo: 'R3',
              tipo: 'alergia',
              bloqueante: 0,
              exige_justificativa: 0,
              numero_versao_vigente: 1,
              vigente_desde: '2026-10-01',
              ativa: 1,
              descricao: 'Avisa',
              autor: '',
              criado_em: null,
            },
          ]
        : [],
    );
    const r = await cat.regrasAlerta(C);
    expect(r.map((x) => [x.nivel, x.versao, x.ativa])).toEqual([
      ['bloqueio', 2, true],
      ['justificar', 1, false],
      ['aviso', 1, true],
    ]);
    expect(r[0]).toEqual({
      id: 1,
      codigo: 'R1',
      tipo: 'interacao',
      nivel: 'bloqueio',
      versao: 2,
      vigenteDesde: '2026-11-01',
      ativa: true,
      descricao: 'Bloqueia',
      autor: 'admin',
      criadaEm: '2026-11-01T09:00:00',
    });
    expect(chamadas.at(-1)?.parametros[0]).toBe(7);
  });

  it('interações: base vazia = null; menos de dois princípios = []; gravidade pelo código ou pelo nível', async () => {
    expect(
      await duble((sql) => (/COUNT\(\*\)/.test(sql) ? [{ versao: null, n: 0 }] : [])).cat.interacoes(
        C,
        [1, 2],
      ),
    ).toBeNull();
    const { cat, chamadas } = duble((sql) =>
      /COUNT\(\*\)/.test(sql)
        ? [{ versao: '2026-11-01', n: 3 }]
        : /FROM interacao_medicamentosa im/.test(sql)
          ? [
              {
                a: 1,
                b: 2,
                codigo: 'GRAVE',
                nivel: 3,
                efeito: 'Sangramento',
                referencia_bibliografica: null,
              },
              { a: 1, b: 3, codigo: 'x', nivel: 9, efeito: 'Arritmia', referencia_bibliografica: 'Ref' },
            ]
          : [],
    );
    expect(await cat.interacoes(C, [1])).toEqual([]);
    expect(await cat.interacoes(C, [1, 2, 3, 2])).toEqual([
      {
        a: 1,
        b: 2,
        gravidade: 'grave',
        efeito: 'Sangramento',
        fonte: 'Cadastro de interações do hospital',
        versaoBase: '2026-11-01',
      },
      { a: 1, b: 3, gravidade: 'contraindicada', efeito: 'Arritmia', fonte: 'Ref', versaoBase: '2026-11-01' },
    ]);
    expect(chamadas.at(-1)?.parametros).toEqual([1, 2, 3, 1, 2, 3]);
  });

  it('instante do civil: hora local do fuso em UTC; formato inválido recusa com 400', () => {
    expect(instanteDoCivil('2026-11-23T13:00', 'America/Sao_Paulo').toISOString()).toBe(
      '2026-11-23T16:00:00.000Z',
    );
    expect(instanteDoCivil('2026-07-01T00:00:30', 'Europe/Lisbon').toISOString()).toBe(
      '2026-06-30T23:00:30.000Z',
    );
    expect(() => instanteDoCivil('ontem', 'UTC')).toThrow(/formato/);
  });
});
