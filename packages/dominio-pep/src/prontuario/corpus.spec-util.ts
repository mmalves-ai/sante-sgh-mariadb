// Corpus SINTÉTICO do leitor do prontuário (M15): RTF no estilo do formulário (CP1252 em \'hh), XML do formulário
// gravado com o registro e XML do documento emitido. Nada aqui é dado de pessoa real.
import type { CabecalhoRegistro } from './registro.js';

export const BASE: CabecalhoRegistro = {
  dataHora: '2024-05-01T09:00:00',
  lancadoEm: '2024-05-01T09:05:00',
  suspensoEm: null,
  justificativaSuspensao: null,
  corrigeRegistro: null,
  justificativaRetroativo: null,
  supervisor: null,
  temConteudo: true,
  situacoesDocumento: [1],
  tiposDocumento: [1],
};

export const RTF_SINTETICO =
  String.raw`{\rtf1\ansi\ansicpg1252\deff0\deflang1046{\fonttbl{\f0\fnil\fcharset0 Tahoma;}}
{\colortbl ;\red0\green0\blue255;\red255\green0\blue0;}
\viewkind4\uc1\pard\cf1\b\fs16 QUEIXA PRINCIPAL\cf0\b0\par
\pard\li283 Paciente SINT\'c9TICO refere dor tor\'e1cica h\'e1 2 dias, n\'e3o irradiada.\par
\pard\qc\cf2\b Conduta:\b0\cf0  observa\'e7\'e3o e reavalia\'e7\'e3o\par
\pard termo cl\'ednico: a\'e7\'facar `.concat('\\u8364?\\par\n}');

export function escapar(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface ComponenteSintetico {
  readonly classe: string;
  readonly nome: string;
  readonly titulo: string;
  readonly valor?: string;
  readonly itens?: readonly string[];
  readonly top?: number;
  readonly width?: number;
  readonly auto?: boolean;
}

export function componenteXml(c: ComponenteSintetico, documento = false): string {
  const valor = c.itens
    ? `<value_texto>${c.itens.map((t, i) => `<Item${i}>${escapar(t)}</Item${i}>`).join('')}<Count>${c.itens.length}</Count></value_texto>`
    : `<value>${escapar(c.valor ?? '')}</value>`;
  return (
    `<componente><className>${c.classe}</className><name>${c.nome}</name><top>${c.top ?? 0}</top><left>8</left>` +
    `<height>21</height><width>${c.width ?? 750}</width>` +
    (documento
      ? ''
      : `<autopreenchido>${c.auto ? 'T' : 'F'}</autopreenchido><alergico_ao_item>F</alergico_ao_item>`) +
    `<title>${escapar(c.titulo)}</title>${valor}</componente>`
  );
}

export function xmlEvolucao(comps: readonly ComponenteSintetico[], modelo = 45): string {
  return (
    `<evolucao id_evolucao="${modelo}" id_prcabevol="900001" id_prtpcomp="1" nomeComposicao="EVOLUCAO SINTETICA" tipo="1">` +
    comps.map((c) => componenteXml(c)).join('') +
    '</evolucao>'
  );
}

export function xmlDocumento(comps: readonly ComponenteSintetico[]): string {
  return (
    '<?xml version="1.0" encoding="Windows-1252" standalone="no"?>' +
    '<documento><versaoXML>1</versaoXML>' +
    '<hospital><id_tbhospit>1</id_tbhospit><nome>HOSPITAL SINTETICO</nome><cnpj>00000000000000</cnpj><cnes>1234567</cnes></hospital>' +
    '<paciente><id_htpaciente>77</id_htpaciente><nome>PACIENTE SINTETICO</nome><prontuario>4242</prontuario>' +
    '<nascimento>1980-02-03</nascimento><sexo>F</sexo><cpf>00000000191</cpf><nome_mae>MAE SINTETICA</nome_mae></paciente>' +
    '<atendimento><id_htatendimento>5</id_htatendimento><registro>31337</registro><tipo_atendimento>Internação</tipo_atendimento>' +
    '<leito>101A</leito><medico_assistente><id_tbcbopro>9</id_tbcbopro><nome>DRA SINTETICA</nome><conselho>CRM</conselho>' +
    '<codigo_conselho>12345</codigo_conselho><uf_conselho>RJ</uf_conselho></medico_assistente>' +
    '<data_hora_entrada>2024-05-01 08:30:00</data_hora_entrada><nome_convenio>CONVENIO SINTETICO</nome_convenio></atendimento>' +
    '<responsavel><nome>RESPONSAVEL SINTETICO</nome><parentesco>Filho</parentesco></responsavel>' +
    '<lancamento><id_tabela_origem>900001</id_tabela_origem><tipo_assinatura>Evolução</tipo_assinatura>' +
    '<situacao_documento>Lançado</situacao_documento><data_hora_evento>2024-05-01 09:00:00</data_hora_evento>' +
    '<profissional_evento><nome>DRA SINTETICA</nome><conselho>CRM</conselho><codigo_conselho>12345</codigo_conselho></profissional_evento></lancamento>' +
    '<identificacao><id_prcabevol>900001</id_prcabevol><id_evolucao>45</id_evolucao><nomeComposicao>EVOLUCAO</nomeComposicao><tipo>1</tipo>' +
    `<evolucao>${comps.map((c) => componenteXml(c, true)).join('')}</evolucao></identificacao>` +
    '</documento>'
  );
}
