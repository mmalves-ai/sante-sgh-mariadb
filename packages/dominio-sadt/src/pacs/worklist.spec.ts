// Regras da lista de trabalho DICOM (M47, etapa 3; ficha, regra 8): número de acesso, modalidade, item DICOM, status
// fora de ordem, situação e link do visualizador; e o simulador de modalidade (regra 9). Dados sintéticos.
import { esquemaStatusExame, FORMATO_ACCESSION, FORMATO_UID_DICOM } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { SimuladorModalidade, statusSimulado } from './simulador.js';
import {
  accessionDoItem,
  chaveIdempotenciaMwl,
  chaveNaturalExame,
  chegouForaDeOrdem,
  itemMwlDicom,
  lerModalidadePorSetor,
  linkDoVisualizador,
  modalidadeDoExame,
  nomeDicom,
  situacaoDoExame,
  statusVigente,
  uidDoEstudo,
} from './worklist.js';

const ITEM = {
  accession: 'PC0000000042',
  hospital: 'pc',
  modalidade: 'CT',
  estacao: 'CT',
  paciente: { id: 900001, nome: 'Maria José da Conceição Sintética', nascimento: '1980-05-17', sexo: 'F' },
  exame: { codigo: 'TCCRANIO', nome: 'Tomografia de crânio' },
  agendadoPara: '2026-10-25T09:30',
  urgente: true,
  solicitante: 'Paulo Médico Sintético',
};

describe('número de acesso e chaves', () => {
  it('prefixo do estabelecimento e o ID com 9 dígitos; único pelo ID; sempre no formato DICOM SH', () => {
    expect(accessionDoItem('pc', 42)).toBe('PC000000042');
    expect(accessionDoItem('hs', 42)).toBe('HS000000042');
    expect(accessionDoItem('pc', 1_234_567_890_123)).toBe('PC1234567890123');
    expect(FORMATO_ACCESSION.test(accessionDoItem('pc-x', 7))).toBe(true);
    expect(() => accessionDoItem('pc', 0)).toThrow();
    expect(() => accessionDoItem('pc', 10 ** 14)).toThrow();
  });
  it('um item por exame no estabelecimento; a chave natural do exame lançado', () => {
    expect(chaveIdempotenciaMwl('pc', 15)).toBe('mwl:pc:15');
    expect(
      chaveNaturalExame({ reg: 10, ato: 25, exame: 'TCCR  ', sequencia: 1, data: '2026-10-25T00:00' }),
    ).toBe('10|25|TCCR|1|2026-10-25');
  });
});

describe('modalidade do exame (setor com modalidade DICOM)', () => {
  const porSetor = lerModalidadePorSetor('16:CR;24:US;25:CT;lixo;99:x1');
  const cadastro = [
    { id: 6, sigla: 'CR' },
    { id: 8, sigla: 'CT' },
    { id: 34, sigla: 'RTSTRUCT ' },
  ];
  it('o parâmetro lido ignora o malformado', () => {
    expect([...porSetor.entries()]).toEqual([
      [16, 'CR'],
      [24, 'US'],
      [25, 'CT'],
    ]);
    expect(lerModalidadePorSetor('').size).toBe(0);
    expect(lerModalidadePorSetor(null).size).toBe(0);
  });
  it('a do cadastro do exame vence; senão a do setor (com o ID achado pela sigla); setor sem modalidade é null', () => {
    expect(
      modalidadeDoExame({ ato: 16, modalidadeCadastro: { id: 34, sigla: 'RTSTRUCT ' } }, porSetor, cadastro),
    ).toEqual({
      id: 34,
      sigla: 'RTSTRUCT',
    });
    expect(modalidadeDoExame({ ato: 25, modalidadeCadastro: null }, porSetor, cadastro)).toEqual({
      id: 8,
      sigla: 'CT',
    });
    expect(modalidadeDoExame({ ato: 24, modalidadeCadastro: null }, porSetor, cadastro)).toEqual({
      id: null,
      sigla: 'US',
    });
    expect(modalidadeDoExame({ ato: 15, modalidadeCadastro: null }, porSetor, cadastro)).toBeNull();
  });
});

describe('item da MWL no JSON do DICOM', () => {
  it('as etiquetas da lista de trabalho com o estudo pré-atribuído, o paciente e o passo agendado', () => {
    const i = itemMwlDicom(ITEM) as Record<string, { vr: string; Value?: unknown[] }>;
    expect(i['00080050']).toEqual({ vr: 'SH', Value: ['PC0000000042'] });
    expect(i['00100010']).toEqual({ vr: 'PN', Value: [{ Alphabetic: 'SINTETICA^MARIA JOSE DA CONCEICAO' }] });
    expect(i['00100030']).toEqual({ vr: 'DA', Value: ['19800517'] });
    expect(i['00100040']).toEqual({ vr: 'CS', Value: ['F'] });
    expect(i['00401003']).toEqual({ vr: 'SH', Value: ['STAT'] });
    const uid = (i['0020000D']!.Value as string[])[0]!;
    expect(FORMATO_UID_DICOM.test(uid)).toBe(true);
    expect(uid.length).toBeLessThanOrEqual(64);
    expect(uid).toBe(uidDoEstudo('pc', 'PC0000000042'));
    const sps = (i['00400100']!.Value as Record<string, { Value?: unknown[] }>[])[0]!;
    expect(sps['00080060']!.Value).toEqual(['CT']);
    expect(sps['00400002']!.Value).toEqual(['20261025']);
    expect(sps['00400003']!.Value).toEqual(['093000']);
  });
  it('sem nascimento nem solicitante: o atributo vai vazio (tipo 2 do DICOM); sexo fora de M/F vira O', () => {
    const i = itemMwlDicom({
      ...ITEM,
      paciente: { ...ITEM.paciente, nascimento: null, sexo: 'I' },
      solicitante: null,
      urgente: false,
    }) as Record<string, { vr: string; Value?: unknown[] }>;
    expect(i['00100030']).toEqual({ vr: 'DA' });
    expect(i['00080090']).toEqual({ vr: 'PN' });
    expect(i['00100040']!.Value).toEqual(['O']);
    expect(i['00401003']!.Value).toEqual(['ROUTINE']);
    expect(() => itemMwlDicom({ ...ITEM, accession: 'pc-1' })).toThrow();
  });
  it('o nome DICOM sem acento, com o sobrenome primeiro', () => {
    expect(nomeDicom('ANA')).toBe('ANA');
    expect(nomeDicom("João D'Ávila  Teste")).toBe('TESTE^JOAO D AVILA');
  });
});

describe('status do exame (MPPS) fora de ordem', () => {
  const m = (id: number, status: 'em-andamento' | 'concluido' | 'descontinuado', em: string) => ({
    id,
    status,
    ocorridoEm: em,
  });
  it('o concluído vence o em andamento que chega depois; empate pela hora e pela chegada', () => {
    expect(statusVigente([])).toBeNull();
    expect(
      statusVigente([m(1, 'concluido', '2026-10-25T10:00'), m(2, 'em-andamento', '2026-10-25T09:00')])?.id,
    ).toBe(1);
    expect(
      statusVigente([m(1, 'em-andamento', '2026-10-25T09:00'), m(2, 'concluido', '2026-10-25T10:00')])?.id,
    ).toBe(2);
    expect(
      statusVigente([m(1, 'concluido', '2026-10-25T10:00'), m(2, 'descontinuado', '2026-10-25T09:00')])?.id,
    ).toBe(1);
    expect(
      statusVigente([m(1, 'concluido', '2026-10-25T10:00'), m(2, 'concluido', '2026-10-25T10:00')])?.id,
    ).toBe(2);
  });
  it('fora de ordem: ordem menor ou a mesma ordem com hora anterior', () => {
    expect(chegouForaDeOrdem(null, m(1, 'em-andamento', 'x'))).toBe(false);
    expect(
      chegouForaDeOrdem(m(1, 'concluido', '2026-10-25T10:00'), m(2, 'em-andamento', '2026-10-25T09:00')),
    ).toBe(true);
    expect(
      chegouForaDeOrdem(m(1, 'em-andamento', '2026-10-25T10:00'), m(2, 'em-andamento', '2026-10-25T09:00')),
    ).toBe(true);
    expect(
      chegouForaDeOrdem(m(1, 'em-andamento', '2026-10-25T09:00'), m(2, 'concluido', '2026-10-25T10:00')),
    ).toBe(false);
  });
});

describe('situação e link', () => {
  it('a situação da lista pelo estado da entrega e o status', () => {
    expect(situacaoDoExame({ temModalidade: false, entrega: null, status: null })).toBe('sem-modalidade');
    expect(situacaoDoExame({ temModalidade: true, entrega: null, status: null })).toBe('a-enviar');
    expect(situacaoDoExame({ temModalidade: true, entrega: 'pendente', status: null })).toBe('na-fila');
    expect(situacaoDoExame({ temModalidade: true, entrega: 'sem-parceiro', status: null })).toBe('na-fila');
    expect(situacaoDoExame({ temModalidade: true, entrega: 'enviado', status: null })).toBe('entregue');
    expect(situacaoDoExame({ temModalidade: true, entrega: 'morto', status: null })).toBe('falhou');
    expect(situacaoDoExame({ temModalidade: true, entrega: 'descartado', status: null })).toBe('falhou');
    expect(situacaoDoExame({ temModalidade: true, entrega: 'enviado', status: 'concluido' })).toBe(
      'concluido',
    );
  });
  it('o link troca {estudo} e {acesso} codificados; sem endereço, sem http(s) ou sem UID: null', () => {
    expect(linkDoVisualizador('https://pacs.exemplo/v?study={estudo}&acc={acesso}', '1.2.3', 'PC1')).toBe(
      'https://pacs.exemplo/v?study=1.2.3&acc=PC1',
    );
    expect(linkDoVisualizador('http://127.0.0.1:5447/v/{acesso}', null, 'PC 1')).toBe(
      'http://127.0.0.1:5447/v/PC%201',
    );
    expect(linkDoVisualizador('https://pacs.exemplo/v?study={estudo}', null, 'PC1')).toBeNull();
    expect(linkDoVisualizador('', '1.2', 'PC1')).toBeNull();
    expect(linkDoVisualizador('javascript:alert({estudo})', '1.2', 'PC1')).toBeNull();
    expect(linkDoVisualizador('https://pacs.exemplo/sem-marca', '1.2', 'PC1')).toBeNull();
  });
});

describe('simulador de modalidade (regra 9)', () => {
  it('o reenvio com o mesmo número de acesso atualiza o item, sem duplicar; o status traz o UID do item', () => {
    const s = new SimuladorModalidade();
    expect(s.receber(itemMwlDicom(ITEM)).situacao).toBe('criado');
    expect(s.receber(itemMwlDicom(ITEM)).situacao).toBe('atualizado');
    expect(s.itens()).toHaveLength(1);
    expect(s.item('PC0000000042')).toMatchObject({ modalidade: 'CT', recebimentos: 2 });
    const a = s.status('PC0000000042', 'em-andamento', '2026-10-25T09:31:00.000');
    const b = s.status('PC0000000042', 'concluido', '2026-10-25T09:45:00');
    expect(a.mensagem).not.toBe(b.mensagem);
    expect(b.uidEstudo).toBe(uidDoEstudo('pc', 'PC0000000042'));
    expect(esquemaStatusExame.safeParse(a).success).toBe(true);
    expect(esquemaStatusExame.safeParse(b).success).toBe(true);
    expect(() => s.receber({})).toThrow();
  });
  it('a mensagem sem estado é determinística (repetir o passo repete a mensagem)', () => {
    const x = {
      accession: 'PC0000000042',
      uidEstudo: '2.25.7',
      status: 'concluido' as const,
      envio: 1,
      ocorridoEm: '2026-10-25T10:00:00',
    };
    expect(statusSimulado(x)).toEqual(statusSimulado(x));
    expect(esquemaStatusExame.safeParse(statusSimulado(x)).success).toBe(true);
    expect(statusSimulado({ ...x, envio: 2 }).mensagem).not.toBe(statusSimulado(x).mensagem);
  });
  it('o status concluído sem UID é recusado pelo contrato', () => {
    const r = esquemaStatusExame.safeParse({
      mensagem: 'MSG-0000001',
      accession: 'PC0000000042',
      status: 'concluido',
      uidEstudo: null,
      ocorridoEm: '2026-10-25T10:00',
    });
    expect(r.success).toBe(false);
  });
});
