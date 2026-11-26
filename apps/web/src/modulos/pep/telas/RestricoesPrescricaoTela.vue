<script setup lang="ts">
// Restrições do hospital no apoio à decisão da prescrição (03-PEP L108; ANVISA RDC 36/2013, ISMP): numa tela só, a
// farmácia clínica cadastra o ajuste de dose por faixa de função renal (ou Child-Pugh, ou diálise), a restrição de
// posologia por paciente e setor e o comportamento do alerta em cada setor. O alvo sai da busca do item: vale para o
// item ou para o princípio ativo dele (todas as apresentações). Validação na hora; desligar é gravar inativo.
import {
  AJUSTES_RENAIS,
  COMPORTAMENTOS_CONFIGURACAO,
  COMPORTAMENTOS_RESTRICAO,
  CRITERIOS_AJUSTE_RENAL,
  problemasFaixaRenal,
  problemasRestricao,
  TIPOS_RESTRICAO_POSOLOGIA,
} from '@sgh/dominio-pep';
import type { ItemBuscado } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { buscarProdutos } from '../api-prescricao.js';
import { gravarRestricaoPrescricao, lerRestricoes } from '../api-restricoes-prescricao.js';

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      x1: 'Buscar',
      x2: 'Vale para',
      x3: 'Critério',
      x4: 'Classe',
      x5: 'Modalidade',
      x6: 'Ajuste',
      x7: 'Unidade',
      x8: 'Comportamento',
      x9: 'Gravar ajuste',
      x10: 'Tipo',
      x11: 'Setor',
      x12: 'Via',
      x13: 'Sexo',
      x14: 'Gravar restrição',
      x15: 'Regra',
      x16: 'Gravar configuração',
      x17: 'Cadastro',
      x18: 'Desligar',
      x19: 'O princípio ativo (todas as apresentações)',
      x20: 'Só este item',
      x21: 'Escolha',
      x22: 'A',
      x23: 'B',
      x24: 'C',
      x25: 'Hemodiálise',
      x26: 'Diálise peritoneal',
      x27: 'Terapia contínua',
      x28: 'Todos',
      x29: 'Sim',
      x30: 'Não',
      x31: 'Restrições da prescrição',
      x32: 'Ajuste de dose pela função renal ou hepática, restrições por paciente e setor e o comportamento de cada\n      alerta no setor. Valem na verificação da prescrição; a decisão de quem prescreve fica registrada.',
      x33: 'Item ou princípio ativo',
      x34: 'Buscar item',
      x35: 'Escolhido:',
      x36: 'Ajuste de dose por faixa',
      x37: 'Faixa mínima',
      x38: 'Faixa máxima',
      x39: 'Dose máxima',
      x40: '% da dose usual',
      x41: 'Intervalo mínimo (h)',
      x42: 'Orientação',
      x43: 'Restrição de posologia',
      x44: 'Idade mínima (dias)',
      x45: 'Idade máxima (dias)',
      x46: 'Peso mínimo (kg)',
      x47: 'Peso máximo (kg)',
      x48: 'Só gestante',
      x49: 'Só lactante',
      x50: 'Por dose',
      x51: 'No dia',
      x52: 'Mensagem ao prescritor',
      x53: 'Alerta por setor',
      x54: 'Desde',
      x55: 'Até',
      x56: 'Alerta ligado no\n          setor',
      x57: 'Ajustes por faixa',
      x58: 'Alvo',
      x59: 'Faixa',
      x60: 'Restrições de posologia',
      x61: 'Mensagem',
      x62: 'Alertas por setor',
      x63: 'Vigência',
      x64: 'Ligado',
      x65: 'a',
    },
  },
});
const cliente = useQueryClient();
const q = useQuery({ queryKey: ['presc', 'restricoes'], queryFn: () => lerRestricoes(), staleTime: 0 });
const d = computed(() => q.data.value);
const podeEditar = computed(() => pode('pep.regraAlerta.editar'));
const erro = ref<unknown>(null);
const ok = ref('');

const ROTULO: Record<string, string> = {
  depuracao_creatinina: 'Depuração de creatinina (mL/min)',
  taxa_filtracao_glomerular: 'Taxa de filtração glomerular (mL/min/1,73 m²)',
  child_pugh: 'Função hepática (Child-Pugh)',
  dialise: 'Diálise',
  reduzir_dose: 'Reduzir a dose',
  aumentar_intervalo: 'Aumentar o intervalo',
  reduzir_dose_e_intervalo: 'Reduzir a dose e aumentar o intervalo',
  evitar: 'Evitar',
  sem_ajuste: 'Sem ajuste',
  avisar: 'Avisar',
  exigir_justificativa: 'Exigir justificativa',
  bloquear: 'Bloquear',
  aviso: 'Avisar',
  exige_justificativa: 'Exigir justificativa',
  bloqueio: 'Bloquear',
  contraindicacao: 'Contraindicação',
  dose_maxima: 'Dose máxima',
  via_proibida: 'Via proibida',
  forma_proibida: 'Forma proibida',
};
const MSG: Record<string, string> = {
  'faixa-invertida': 'A faixa mínima passa da máxima.',
  'classe-hepatica-obrigatoria': 'Escolha a classe de Child-Pugh.',
  'modalidade-dialise-obrigatoria': 'Escolha a modalidade de diálise.',
  'faixa-obrigatoria': 'Informe ao menos um limite da faixa.',
  'percentual-invalido': 'O percentual vai de 0 a 100.',
  'reducao-sem-limite': 'Reduzir a dose pede a dose máxima ou o percentual.',
  'intervalo-obrigatorio': 'Aumentar o intervalo pede o intervalo mínimo.',
  'mensagem-obrigatoria': 'Escreva a mensagem ao prescritor.',
  'dose-obrigatoria': 'Informe a dose máxima por dose ou no dia.',
  'via-obrigatoria': 'Escolha a via proibida.',
  'idade-invertida': 'A idade mínima passa da máxima.',
  'peso-invertido': 'O peso mínimo passa do máximo.',
};
const opcoes = (vs: readonly string[]) => vs.map((v) => ({ valor: v, rotulo: ROTULO[v] ?? v }));
const opcoesId = (vs: readonly { id: number; nome: string }[] | undefined, vazio: string) => [
  { valor: '', rotulo: vazio },
  ...(vs ?? []).map((x) => ({ valor: String(x.id), rotulo: x.nome })),
];
const numero = (s: string): number | null => (s.trim() === '' ? null : Number(s.replace(',', '.')));
const idOuNull = (s: string): number | null => (s === '' ? null : Number(s));

// ── alvo pela busca do item ──
const termo = ref('');
const achados = ref<ItemBuscado[]>([]);
const escolhido = ref<ItemBuscado | null>(null);
const alvoTipo = ref<'item' | 'principio'>('principio');
async function buscar(): Promise<void> {
  if (termo.value.trim().length < 3) return;
  try {
    achados.value = await buscarProdutos(termo.value.trim());
  } catch (e) {
    erro.value = e;
  }
}
const alvo = computed(() => {
  const p = escolhido.value;
  if (!p) return { item: null, principio: null };
  const princ = p.principiosAtivos[0]?.id ?? null;
  return alvoTipo.value === 'principio' && princ !== null
    ? { item: null, principio: princ }
    : { item: p.produto, principio: null };
});

// ── ajuste por faixa ──
const aj = ref({
  criterio: 'depuracao_creatinina',
  faixaMinima: '',
  faixaMaxima: '',
  classeHepatica: '',
  modalidadeDialise: '',
  ajuste: 'reduzir_dose',
  percentualDose: '',
  doseMaxima: '',
  unidade: '',
  intervaloHoras: '',
  comportamento: 'exigir_justificativa',
  orientacao: '',
});
const corpoAjuste = computed(() => ({
  ...alvo.value,
  criterio: aj.value.criterio as (typeof CRITERIOS_AJUSTE_RENAL)[number],
  faixaMinima: numero(aj.value.faixaMinima),
  faixaMaxima: numero(aj.value.faixaMaxima),
  classeHepatica: (aj.value.classeHepatica || null) as 'A' | 'B' | 'C' | null,
  modalidadeDialise: aj.value.modalidadeDialise || null,
  ajuste: aj.value.ajuste as (typeof AJUSTES_RENAIS)[number],
  percentualDose: numero(aj.value.percentualDose),
  doseMaxima: numero(aj.value.doseMaxima),
  unidade: idOuNull(aj.value.unidade),
  intervaloHoras: numero(aj.value.intervaloHoras),
  comportamento: aj.value.comportamento as (typeof COMPORTAMENTOS_RESTRICAO)[number],
  orientacao: aj.value.orientacao.trim() || null,
}));
const problemasAjuste = computed(() => [
  ...(escolhido.value ? [] : ['Escolha o item pela busca.']),
  ...problemasFaixaRenal(corpoAjuste.value).map((c) => MSG[c] ?? c),
]);

// ── restrição de posologia ──
const rp = ref({
  tipo: 'contraindicacao',
  setor: '',
  via: '',
  sexo: '',
  idadeMinimaDias: '',
  idadeMaximaDias: '',
  pesoMinimoKg: '',
  pesoMaximoKg: '',
  gestante: false,
  lactante: false,
  doseMaxima: '',
  doseMaximaDiaria: '',
  unidade: '',
  acao: 'avisar',
  mensagem: '',
});
const corpoRestricao = computed(() => ({
  ...alvo.value,
  tipo: rp.value.tipo as (typeof TIPOS_RESTRICAO_POSOLOGIA)[number],
  setor: idOuNull(rp.value.setor),
  via: idOuNull(rp.value.via),
  sexo: idOuNull(rp.value.sexo),
  idadeMinimaDias: numero(rp.value.idadeMinimaDias),
  idadeMaximaDias: numero(rp.value.idadeMaximaDias),
  pesoMinimoKg: numero(rp.value.pesoMinimoKg),
  pesoMaximoKg: numero(rp.value.pesoMaximoKg),
  gestante: rp.value.gestante ? true : null,
  lactante: rp.value.lactante ? true : null,
  doseMaxima: numero(rp.value.doseMaxima),
  doseMaximaDiaria: numero(rp.value.doseMaximaDiaria),
  unidade: idOuNull(rp.value.unidade),
  acao: rp.value.acao as (typeof COMPORTAMENTOS_RESTRICAO)[number],
  mensagem: rp.value.mensagem,
}));
const problemasPosologia = computed(() => [
  ...(escolhido.value ? [] : ['Escolha o item pela busca.']),
  ...problemasRestricao({
    ...corpoRestricao.value,
    via: corpoRestricao.value.via === null ? null : String(corpoRestricao.value.via),
  }).map((c) => MSG[c] ?? c),
]);

// ── alerta por setor ──
const cf = ref({
  regra: '',
  setor: '',
  comportamento: 'aviso',
  vigenciaInicio: '',
  vigenciaFim: '',
  ativo: true,
});

async function gravar(
  tipo: 'ajustes-renais' | 'posologia' | 'configuracoes',
  corpo: Record<string, unknown>,
) {
  erro.value = null;
  ok.value = '';
  try {
    await gravarRestricaoPrescricao(tipo, corpo);
    ok.value = 'Gravado. A próxima verificação da prescrição já usa o cadastro.';
    await cliente.invalidateQueries({ queryKey: ['presc', 'restricoes'] });
  } catch (e) {
    erro.value = e;
  }
}
const desligar = (tipo: 'ajustes-renais' | 'posologia' | 'configuracoes', linha: Record<string, unknown>) => {
  const resto: Record<string, unknown> = { ...linha };
  const tipoLinha = resto['tipo'];
  delete resto['alvoNome'];
  delete resto['regraCodigo'];
  delete resto['tipo'];
  return gravar(tipo, {
    ...resto,
    ...(tipo === 'posologia' ? { tipo: tipoLinha } : {}),
    ativo: false,
  });
};
</script>

<template>
  <section class="tela" aria-labelledby="rp-titulo" data-testid="tela-restricoes-prescricao">
    <h1 id="rp-titulo">{{ t('x31') }}</h1>
    <p>
      {{ t('x32') }}
    </p>
    <MensagemErro v-if="erro" :erro="erro" />
    <SanteAlerta v-if="ok" variante="info" :texto="ok" data-testid="rp-ok" />

    <form v-if="podeEditar" class="bloco" data-testid="rp-alvo" @submit.prevent="buscar">
      <h2>{{ t('x33') }}</h2>
      <div class="barra">
        <label class="campo"
          >{{ t('x34') }}
          <input v-model="termo" data-testid="rp-busca" minlength="3" />
        </label>
        <SanteBotao :rotulo="t('x1')" tipo="submit" data-testid="rp-buscar" />
      </div>
      <ul v-if="achados.length" class="achados">
        <li v-for="p in achados" :key="p.produto">
          <button type="button" :data-testid="`rp-item-${p.produto}`" @click="escolhido = p">
            {{ p.nome
            }}<span v-if="p.principiosAtivos.length">
              ({{ p.principiosAtivos.map((x) => x.nome).join(', ') }})</span
            >
          </button>
        </li>
      </ul>
      <p v-if="escolhido" data-testid="rp-escolhido">{{ t('x35') }} {{ escolhido.nome }}</p>
      <SanteSelecao
        v-model="alvoTipo"
        :rotulo="t('x2')"
        :opcoes="[
          { valor: 'principio', rotulo: t('x19') },
          { valor: 'item', rotulo: t('x20') },
        ]"
        data-testid="rp-alvo-tipo"
      />
    </form>

    <form
      v-if="podeEditar"
      class="bloco"
      data-testid="rp-ajuste"
      @submit.prevent="gravar('ajustes-renais', corpoAjuste)"
    >
      <h2>{{ t('x36') }}</h2>
      <div class="barra">
        <SanteSelecao
          v-model="aj.criterio"
          :rotulo="t('x3')"
          :opcoes="opcoes(CRITERIOS_AJUSTE_RENAL)"
          data-testid="rp-criterio"
        />
        <label class="campo"
          >{{ t('x37') }}<input v-model="aj.faixaMinima" inputmode="decimal" data-testid="rp-faixa-min"
        /></label>
        <label class="campo"
          >{{ t('x38') }}<input v-model="aj.faixaMaxima" inputmode="decimal" data-testid="rp-faixa-max"
        /></label>
        <SanteSelecao
          v-if="aj.criterio === 'child_pugh'"
          v-model="aj.classeHepatica"
          :rotulo="t('x4')"
          :opcoes="[
            { valor: '', rotulo: t('x21') },
            { valor: 'A', rotulo: t('x22') },
            { valor: 'B', rotulo: t('x23') },
            { valor: 'C', rotulo: t('x24') },
          ]"
          data-testid="rp-classe"
        />
        <SanteSelecao
          v-if="aj.criterio === 'dialise'"
          v-model="aj.modalidadeDialise"
          :rotulo="t('x5')"
          :opcoes="[
            { valor: '', rotulo: t('x21') },
            { valor: 'hemodialise', rotulo: t('x25') },
            { valor: 'dialise_peritoneal', rotulo: t('x26') },
            { valor: 'terapia_continua', rotulo: t('x27') },
          ]"
          data-testid="rp-dialise"
        />
      </div>
      <div class="barra">
        <SanteSelecao
          v-model="aj.ajuste"
          :rotulo="t('x6')"
          :opcoes="opcoes(AJUSTES_RENAIS)"
          data-testid="rp-ajuste-tipo"
        />
        <label class="campo"
          >{{ t('x39') }}<input v-model="aj.doseMaxima" inputmode="decimal" data-testid="rp-dose-max"
        /></label>
        <label class="campo"
          >{{ t('x40') }}<input v-model="aj.percentualDose" inputmode="decimal" data-testid="rp-percentual"
        /></label>
        <SanteSelecao
          v-model="aj.unidade"
          :rotulo="t('x7')"
          :opcoes="opcoesId(d?.apoio.unidades, 'Sem unidade')"
          data-testid="rp-unidade"
        />
        <label class="campo"
          >{{ t('x41') }}<input v-model="aj.intervaloHoras" inputmode="numeric" data-testid="rp-intervalo"
        /></label>
        <SanteSelecao
          v-model="aj.comportamento"
          :rotulo="t('x8')"
          :opcoes="opcoes(COMPORTAMENTOS_RESTRICAO)"
          data-testid="rp-comportamento"
        />
      </div>
      <label class="campo"
        >{{ t('x42') }}<input v-model="aj.orientacao" maxlength="1000" data-testid="rp-orientacao"
      /></label>
      <ul v-if="problemasAjuste.length" class="problemas" data-testid="rp-problemas-ajuste">
        <li v-for="p in problemasAjuste" :key="p">{{ p }}</li>
      </ul>
      <SanteBotao
        :rotulo="t('x9')"
        tipo="submit"
        :desabilitado="problemasAjuste.length > 0"
        data-testid="rp-gravar-ajuste"
      />
    </form>

    <form
      v-if="podeEditar"
      class="bloco"
      data-testid="rp-posologia"
      @submit.prevent="gravar('posologia', corpoRestricao)"
    >
      <h2>{{ t('x43') }}</h2>
      <div class="barra">
        <SanteSelecao
          v-model="rp.tipo"
          :rotulo="t('x10')"
          :opcoes="opcoes(TIPOS_RESTRICAO_POSOLOGIA)"
          data-testid="rp-tipo"
        />
        <SanteSelecao
          v-model="rp.setor"
          :rotulo="t('x11')"
          :opcoes="opcoesId(d?.apoio.setores, 'Todos os setores')"
          data-testid="rp-setor"
        />
        <SanteSelecao
          v-model="rp.via"
          :rotulo="t('x12')"
          :opcoes="opcoesId(d?.apoio.vias, 'Qualquer via')"
          data-testid="rp-via"
        />
        <SanteSelecao
          v-model="rp.sexo"
          :rotulo="t('x13')"
          :opcoes="opcoesId(d?.apoio.sexos, 'Qualquer')"
          data-testid="rp-sexo"
        />
      </div>
      <div class="barra">
        <label class="campo"
          >{{ t('x44') }}<input v-model="rp.idadeMinimaDias" inputmode="numeric" data-testid="rp-idade-min"
        /></label>
        <label class="campo"
          >{{ t('x45') }}<input v-model="rp.idadeMaximaDias" inputmode="numeric" data-testid="rp-idade-max"
        /></label>
        <label class="campo"
          >{{ t('x46') }}<input v-model="rp.pesoMinimoKg" inputmode="decimal" data-testid="rp-peso-min"
        /></label>
        <label class="campo"
          >{{ t('x47') }}<input v-model="rp.pesoMaximoKg" inputmode="decimal" data-testid="rp-peso-max"
        /></label>
        <label class="marcar"
          ><input v-model="rp.gestante" type="checkbox" data-testid="rp-gestante" /> {{ t('x48') }}</label
        >
        <label class="marcar"
          ><input v-model="rp.lactante" type="checkbox" data-testid="rp-lactante" /> {{ t('x49') }}</label
        >
      </div>
      <div v-if="rp.tipo === 'dose_maxima'" class="barra">
        <label class="campo"
          >{{ t('x50') }}<input v-model="rp.doseMaxima" inputmode="decimal" data-testid="rp-r-dose"
        /></label>
        <label class="campo"
          >{{ t('x51') }}<input v-model="rp.doseMaximaDiaria" inputmode="decimal" data-testid="rp-r-dia"
        /></label>
        <SanteSelecao
          v-model="rp.unidade"
          :rotulo="t('x7')"
          :opcoes="opcoesId(d?.apoio.unidades, 'Escolha')"
          data-testid="rp-r-unidade"
        />
      </div>
      <div class="barra">
        <SanteSelecao
          v-model="rp.acao"
          :rotulo="t('x8')"
          :opcoes="opcoes(COMPORTAMENTOS_RESTRICAO)"
          data-testid="rp-acao"
        />
        <label class="campo"
          >{{ t('x52') }}<input v-model="rp.mensagem" maxlength="500" data-testid="rp-mensagem"
        /></label>
      </div>
      <ul v-if="problemasPosologia.length" class="problemas" data-testid="rp-problemas-posologia">
        <li v-for="p in problemasPosologia" :key="p">{{ p }}</li>
      </ul>
      <SanteBotao
        :rotulo="t('x14')"
        tipo="submit"
        :desabilitado="problemasPosologia.length > 0"
        data-testid="rp-gravar-restricao"
      />
    </form>

    <form
      v-if="podeEditar"
      class="bloco"
      data-testid="rp-configuracao"
      @submit.prevent="
        gravar('configuracoes', {
          regra: Number(cf.regra),
          setor: idOuNull(cf.setor),
          comportamento: cf.comportamento,
          vigenciaInicio: cf.vigenciaInicio || null,
          vigenciaFim: cf.vigenciaFim || null,
          ativo: cf.ativo,
        })
      "
    >
      <h2>{{ t('x53') }}</h2>
      <div class="barra">
        <SanteSelecao
          v-model="cf.regra"
          :rotulo="t('x15')"
          :opcoes="opcoesId(d?.apoio.regras, 'Escolha')"
          data-testid="rp-regra"
        />
        <SanteSelecao
          v-model="cf.setor"
          :rotulo="t('x11')"
          :opcoes="opcoesId(d?.apoio.setores, 'Todo o estabelecimento')"
          data-testid="rp-cf-setor"
        />
        <SanteSelecao
          v-model="cf.comportamento"
          :rotulo="t('x8')"
          :opcoes="opcoes(COMPORTAMENTOS_CONFIGURACAO)"
          data-testid="rp-cf-comportamento"
        />
        <label class="campo"
          >{{ t('x54') }}<input v-model="cf.vigenciaInicio" type="date" data-testid="rp-cf-inicio"
        /></label>
        <label class="campo"
          >{{ t('x55') }}<input v-model="cf.vigenciaFim" type="date" data-testid="rp-cf-fim"
        /></label>
        <label class="marcar"
          ><input v-model="cf.ativo" type="checkbox" data-testid="rp-cf-ativo" /> {{ t('x56') }}</label
        >
      </div>
      <SanteBotao
        :rotulo="t('x16')"
        tipo="submit"
        :desabilitado="cf.regra === ''"
        data-testid="rp-gravar-configuracao"
      />
    </form>

    <section class="bloco" :aria-label="t('x17')" data-testid="rp-lista">
      <h2>{{ t('x57') }}</h2>
      <table class="tabela" data-testid="rp-lista-ajustes">
        <thead>
          <tr>
            <th>{{ t('x58') }}</th>
            <th>{{ t('x3') }}</th>
            <th>{{ t('x59') }}</th>
            <th>{{ t('x6') }}</th>
            <th>{{ t('x8') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in d?.ajustes ?? []" :key="a.id" :class="{ inativo: !a.ativo }">
            <td>{{ a.alvoNome }}</td>
            <td>{{ ROTULO[a.criterio] ?? a.criterio }}</td>
            <td>
              {{
                a.classeHepatica ?? a.modalidadeDialise ?? `${a.faixaMinima ?? '…'} a ${a.faixaMaxima ?? '…'}`
              }}
            </td>
            <td>{{ ROTULO[a.ajuste] ?? a.ajuste }}</td>
            <td>{{ ROTULO[a.comportamento] ?? a.comportamento }}</td>
            <td>
              <SanteBotao
                v-if="a.ativo && podeEditar"
                :rotulo="t('x18')"
                variante="secundario"
                @click="desligar('ajustes-renais', a)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <h2>{{ t('x60') }}</h2>
      <table class="tabela" data-testid="rp-lista-restricoes">
        <thead>
          <tr>
            <th>{{ t('x58') }}</th>
            <th>{{ t('x10') }}</th>
            <th>{{ t('x61') }}</th>
            <th>{{ t('x8') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in d?.restricoes ?? []" :key="r.id" :class="{ inativo: !r.ativo }">
            <td>{{ r.alvoNome }}</td>
            <td>{{ ROTULO[r.tipo] ?? r.tipo }}</td>
            <td>{{ r.mensagem }}</td>
            <td>{{ ROTULO[r.acao] ?? r.acao }}</td>
            <td>
              <SanteBotao
                v-if="r.ativo && podeEditar"
                :rotulo="t('x18')"
                variante="secundario"
                @click="desligar('posologia', r)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <h2>{{ t('x62') }}</h2>
      <table class="tabela" data-testid="rp-lista-configuracoes">
        <thead>
          <tr>
            <th>{{ t('x15') }}</th>
            <th>{{ t('x11') }}</th>
            <th>{{ t('x8') }}</th>
            <th>{{ t('x63') }}</th>
            <th>{{ t('x64') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in d?.configuracoes ?? []" :key="c.id">
            <td>{{ c.regraCodigo }}</td>
            <td>{{ d?.apoio.setores.find((s) => s.id === c.setor)?.nome ?? t('x28') }}</td>
            <td>{{ ROTULO[c.comportamento] ?? c.comportamento }}</td>
            <td>{{ c.vigenciaInicio ?? '…' }} {{ t('x65') }} {{ c.vigenciaFim ?? '…' }}</td>
            <td>{{ c.ativo ? t('x29') : t('x30') }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<style scoped>
.tela,
.bloco {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.barra {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.problemas {
  color: var(--sgh-alerta);
}
.inativo {
  opacity: 0.6;
}
</style>
