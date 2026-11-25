// Regras da interface com os equipamentos do laboratório (F3.5, 05-SADT linha 13). Massa sintética.
import { describe, expect, it } from 'vitest';
import {
  conferirDeParaAnalito,
  conferirDeParaExame,
  conferirInterface,
  converterValor,
  type DeParaAnalitoEquipamento,
  type DeParaExameEquipamento,
  type InterfaceEquipamento,
  interpretarLeituras,
  lerAstmResultado,
  montarAstmPedido,
  montarPedidoEquipamento,
} from './interface.js';

const base: InterfaceEquipamento = {
  codigo: 'BIOQ-01',
  descricao: 'Bioquímica 1',
  protocolo: 'astm',
  sentido: 'bidirecional',
  padraoDoModelo: 'astm',
  sentidoDoModelo: 'bidirecional',
  host: '10.0.0.9',
  porta: 5000,
  caminhoEnvio: null,
  caminhoRetorno: null,
  enviaListaTrabalho: true,
  recebeResultado: true,
  importaComoLiberado: false,
  revisaAutomaticamente: false,
  assinaAutomaticamente: false,
  ativo: true,
};
const campos = (e: Partial<InterfaceEquipamento>) => conferirInterface({ ...base, ...e }).map((p) => p.campo);

describe('cadastro da interface do equipamento', () => {
  it('aceita a interface coerente', () => {
    expect(conferirInterface(base)).toEqual([]);
  });

  it('devolve todos os problemas de uma vez, cada um no seu campo', () => {
    expect(
      campos({ codigo: 'com espaço', descricao: 'x', padraoDoModelo: 'hl7_v2', host: ' ', porta: null }),
    ).toEqual(['codigo', 'descricao', 'protocolo', 'host', 'porta']);
    expect(campos({ padraoDoModelo: null })).toEqual(['modelo']);
    expect(campos({ porta: 70000 })).toEqual(['porta']);
  });

  it('mão única não envia lista de trabalho nem vira mão dupla sobre modelo de mão única', () => {
    expect(campos({ sentido: 'unidirecional' })).toEqual(['enviaListaTrabalho']);
    expect(campos({ sentidoDoModelo: 'unidirecional' })).toEqual(['sentido']);
    expect(campos({ sentido: 'unidirecional', enviaListaTrabalho: false })).toEqual([]);
    expect(campos({ enviaListaTrabalho: false, recebeResultado: false })).toEqual(['recebeResultado']);
  });

  it('liberação e assinatura automáticas só com o resultado recebido e entrando liberado', () => {
    expect(campos({ recebeResultado: false, importaComoLiberado: true })).toEqual(['importaComoLiberado']);
    expect(campos({ assinaAutomaticamente: true })).toEqual(['assinaAutomaticamente']);
    expect(campos({ importaComoLiberado: true, assinaAutomaticamente: true })).toEqual([]);
  });

  it('por arquivo exige as pastas do que trafega; a inativa pode ficar sem endereço', () => {
    const arquivo = {
      protocolo: 'arquivo',
      padraoDoModelo: 'arquivo_texto',
      host: null,
      porta: null,
    } as const;
    expect(campos(arquivo)).toEqual(['caminhoRetorno', 'caminhoEnvio']);
    expect(campos({ ...arquivo, caminhoRetorno: '/r', caminhoEnvio: '/e' })).toEqual([]);
    expect(campos({ host: null, porta: null, ativo: false })).toEqual([]);
  });
});

const dpExames: DeParaExameEquipamento[] = [
  { exame: 10, material: null, codigo: 'GLI', enviaAnalitos: false },
  { exame: 10, material: 7, codigo: 'GLI-U', enviaAnalitos: false },
  { exame: 20, material: null, codigo: 'HEMO', enviaAnalitos: true },
];
const dpAnalitos: DeParaAnalitoEquipamento[] = [
  { analito: 100, exame: null, codigo: 'GLU', fator: 1, casas: 0, recebe: true },
  { analito: 200, exame: 20, codigo: 'HGB', fator: 0.1, casas: 1, recebe: true },
  { analito: 201, exame: null, codigo: 'WBC', fator: 1000, casas: null, recebe: true },
  { analito: 202, exame: null, codigo: 'QC1', fator: 1, casas: null, recebe: false },
];

describe('de-para do equipamento', () => {
  it('recusa o par exame e material repetido e o código com separador', () => {
    expect(
      conferirDeParaExame({ exame: 10, material: 7, codigo: 'X|Y', enviaAnalitos: false }, dpExames).map(
        (p) => p.campo,
      ),
    ).toEqual(['codigo', 'exame']);
    expect(
      conferirDeParaExame({ exame: 10, material: 8, codigo: 'GLI-S', enviaAnalitos: false }, dpExames),
    ).toEqual([]);
  });

  it('recusa código de analito repetido, fator não positivo e casas fora de 0 a 6', () => {
    expect(
      conferirDeParaAnalito(
        { analito: 300, exame: null, codigo: 'GLU', fator: 0, casas: 7, recebe: true },
        dpAnalitos,
      ).map((p) => p.campo),
    ).toEqual(['codigo', 'fator', 'casas']);
    expect(
      conferirDeParaAnalito(
        { analito: 300, exame: null, codigo: 'K', fator: 1, casas: 2, recebe: true },
        dpAnalitos,
      ),
    ).toEqual([]);
  });
});

describe('pedido ao equipamento', () => {
  it('usa o código do material, envia por analito quando pedido e separa o exame sem código', () => {
    const p = montarPedidoEquipamento(
      'A1',
      [
        { item: 1, exame: 10, material: 7, analitos: [100] },
        { item: 2, exame: 20, material: null, analitos: [200, 201, 999] },
        { item: 3, exame: 30, material: null, analitos: [] },
      ],
      dpExames,
      dpAnalitos,
    );
    expect(p.testes).toEqual([
      { item: 1, codigo: 'GLI-U' },
      { item: 2, codigo: 'HGB' },
      { item: 2, codigo: 'WBC' },
    ]);
    expect(p.semDePara).toEqual([3]);
  });

  it('monta o pedido ASTM sem dado do paciente e marca a urgência', () => {
    const m = montarAstmPedido({ amostra: 'A1', testes: ['GLI', 'HGB'], urgente: true });
    expect(m).toBe('H|\\^&\rP|1\rO|1|A1||^^^GLI\\^^^HGB|S\rL|1|N\r');
  });
});

describe('resultado do equipamento', () => {
  it('converte pelo fator e pelas casas; valor não numérico entra como texto', () => {
    expect(converterValor('12,34', 0.1, 1)).toBe(1.2);
    expect(converterValor(' 7.5 ', 1000, null)).toBe(7500);
    expect(converterValor('1.005', 1, 2)).toBe(1.01);
    expect(converterValor('<0,1', 1, 2)).toBeNull();
  });

  it('leva cada leitura ao exame pedido e separa o que não tem de-para, o ignorado e o sem exame', () => {
    const r = interpretarLeituras(
      [
        { codigo: 'GLU', valor: '90' },
        { codigo: 'GLU', valor: '98' },
        { codigo: 'HGB', valor: '135' },
        { codigo: 'WBC', valor: 'Reagente' },
        { codigo: 'QC1', valor: '1' },
        { codigo: 'ZZZ', valor: '3' },
      ],
      [...dpAnalitos, { analito: 900, exame: null, codigo: 'NA', fator: 1, casas: null, recebe: true }],
      [
        { item: 1, exame: 10, material: null, analitos: [100] },
        { item: 2, exame: 20, material: null, analitos: [200, 201, 202] },
      ],
    );
    expect(r.porItem.get(1)).toEqual([{ analito: 100, numero: 98, texto: null }]);
    expect(r.porItem.get(2)).toEqual([
      { analito: 200, numero: 13.5, texto: null },
      { analito: 201, numero: null, texto: 'Reagente' },
    ]);
    expect(r.semDePara).toEqual(['ZZZ']);
    expect(r.ignorados).toEqual(['QC1']);
    const semExame = interpretarLeituras([{ codigo: 'HGB', valor: '1' }], dpAnalitos, [
      { item: 1, exame: 10, material: null, analitos: [100] },
    ]);
    expect(semExame.semExame).toEqual(['HGB']);
  });

  it('lê a mensagem ASTM por amostra, ignora o paciente e tolera o número do quadro', () => {
    const msg =
      'H|\\^&|||EQ\r1P|1||IGNORADO\rO|1|A1^1||^^^GLU\rR|1|^^^GLU|98|mg/dL\rR|2|^^^HGB^1|13,5\r' +
      'O|2|B2\nR|1|^^^WBC|7.5\nL|1|N\r';
    expect(lerAstmResultado(msg).amostras).toEqual([
      {
        amostra: 'A1',
        leituras: [
          { codigo: 'GLU', valor: '98' },
          { codigo: 'HGB', valor: '13,5' },
        ],
      },
      { amostra: 'B2', leituras: [{ codigo: 'WBC', valor: '7.5' }] },
    ]);
    expect(lerAstmResultado('lixo sem registro').amostras).toEqual([]);
  });
});
