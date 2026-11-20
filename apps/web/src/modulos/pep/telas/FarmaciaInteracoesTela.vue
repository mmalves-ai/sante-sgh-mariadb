<script setup lang="ts">
// Interações medicamentosas e validação de dose (M24; ficha, seção 7) e, em modo consulta, "Alertas" da prescrição:
// as regras de alerta (as padrão e as versões gravadas pela farmácia clínica), a situação da base de interações,
// a nova versão de regra (operação crítica, com senha e justificativa) e o simulador (o que a prescrição veria).
import { type ItemPrescricao, NIVEIS_ALERTA, TIPOS_ALERTA, type TipoAlerta } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { gravarRegra, lerRegras, simular } from '../api-prescricao.js';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';

const props = withDefaults(defineProps<{ consulta?: boolean }>(), { consulta: false });
const { t } = useI18n();
const cliente = useQueryClient();
const regras = useQuery({ queryKey: ['presc', 'regras'], queryFn: () => lerRegras(), staleTime: 0 });
const r = computed(() => regras.data.value);
const vigentes = computed(() => {
  const m = new Map<string, NonNullable<typeof r.value>['padrao'][number]>();
  for (const x of [...(r.value?.padrao ?? []), ...(r.value?.versoes ?? [])]) {
    const a = m.get(x.codigo);
    if (!a || x.versao > a.versao) m.set(x.codigo, x);
  }
  return [...m.values()].sort((a, b) => a.codigo.localeCompare(b.codigo));
});
const podeEditar = computed(() => !props.consulta && pode('pep.regraAlerta.editar'));

const nova = ref({
  codigo: '',
  tipo: 'duplicidade' as TipoAlerta,
  nivel: 'justificar' as (typeof NIVEIS_ALERTA)[number],
  vigenteDesde: new Date().toISOString().slice(0, 10),
  ativa: true,
  descricao: '',
  justificativa: '',
  senha: '',
});
const erro = ref<unknown>(null);
const ok = ref('');
async function gravar(): Promise<void> {
  erro.value = null;
  try {
    const g = await gravarRegra({ ...nova.value, codigo: nova.value.codigo || nova.value.tipo });
    ok.value = t('pep.presc.farmacia.gravada', { versao: g.versao });
    nova.value.senha = '';
    await cliente.invalidateQueries({ queryKey: ['presc', 'regras'] });
  } catch (e) {
    erro.value = e;
  }
}

const textoProdutos = ref('');
const textoAlergias = ref('');
const resultado = ref<Awaited<ReturnType<typeof simular>> | null>(null);
async function fazerSimulacao(): Promise<void> {
  erro.value = null;
  const prods = textoProdutos.value
    .split(/\s+/)
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x) && x > 0)
    .slice(0, 30);
  const itens: ItemPrescricao[] = prods.map((p, i) => ({
    chave: `s${i + 1}`,
    detalhe: {
      tipo: 'medicamento',
      item: { produto: p },
      dose: 1,
      unidade: 'UN',
      via: 'VO',
      frequencia: null,
      relativos: [],
      iniciarAgora: false,
      naoAjustar: false,
    },
    autopreenchido: [],
    decisoes: [],
  }));
  if (itens.length === 0) return;
  try {
    resultado.value = await simular({
      itens,
      alergiasPrincipios: textoAlergias.value
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((x) => Number.isInteger(x) && x > 0),
    });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="farm-titulo" data-testid="tela-farmacia-interacoes">
    <h1 id="farm-titulo">
      {{ consulta ? t('pep.presc.farmacia.tituloAlertas') : t('pep.presc.farmacia.tituloInteracoes') }}
    </h1>
    <p>{{ t('pep.presc.farmacia.texto') }}</p>
    <MensagemErro v-if="regras.isError.value" :erro="regras.error.value" />
    <p v-else-if="!r" role="status">{{ t('pep.presc.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        :variante="r.baseInteracoes === 'contratada' ? 'info' : 'aviso'"
        :texto="t('pep.presc.farmacia.base', { situacao: t(`pep.presc.farmacia.bases.${r.baseInteracoes}`) })"
        data-testid="situacao-base"
      />
      <table data-testid="regras-alerta">
        <caption>
          {{
            t('pep.presc.farmacia.regras')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('pep.presc.farmacia.colunas.codigo') }}</th>
            <th scope="col">{{ t('pep.presc.farmacia.colunas.tipo') }}</th>
            <th scope="col">{{ t('pep.presc.farmacia.colunas.nivel') }}</th>
            <th scope="col">{{ t('pep.presc.farmacia.colunas.versao') }}</th>
            <th scope="col">{{ t('pep.presc.farmacia.colunas.desde') }}</th>
            <th scope="col">{{ t('pep.presc.farmacia.colunas.ativa') }}</th>
            <th scope="col">{{ t('pep.presc.farmacia.colunas.descricao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in vigentes" :key="x.codigo" :data-testid="`regra-${x.codigo}`">
            <td>{{ x.codigo }}</td>
            <td>{{ t(`pep.presc.farmacia.tiposAlerta.${x.tipo}`) }}</td>
            <td>{{ t(`pep.presc.alertas.niveis.${x.nivel}`) }}</td>
            <td>{{ x.versao }}</td>
            <td>{{ x.vigenteDesde }}</td>
            <td>{{ x.ativa ? t('pep.presc.farmacia.sim') : t('pep.presc.farmacia.nao') }}</td>
            <td>{{ x.descricao }}</td>
          </tr>
        </tbody>
      </table>

      <form v-if="podeEditar" class="bloco" data-testid="nova-regra" @submit.prevent="gravar">
        <h2>{{ t('pep.presc.farmacia.nova') }}</h2>
        <div class="barra">
          <SanteSelecao
            v-model="nova.tipo"
            :rotulo="t('pep.presc.farmacia.tipo')"
            :opcoes="
              TIPOS_ALERTA.map((x) => ({ valor: x, rotulo: t(`pep.presc.farmacia.tiposAlerta.${x}`) }))
            "
            data-testid="regra-tipo"
          />
          <div class="campo">
            <label for="regra-codigo">{{ t('pep.presc.farmacia.codigo') }}</label>
            <input
              id="regra-codigo"
              v-model="nova.codigo"
              maxlength="40"
              pattern="[a-z][a-z0-9-]{1,39}"
              data-testid="regra-codigo"
            />
          </div>
          <SanteSelecao
            v-model="nova.nivel"
            :rotulo="t('pep.presc.farmacia.nivel')"
            :opcoes="NIVEIS_ALERTA.map((x) => ({ valor: x, rotulo: t(`pep.presc.alertas.niveis.${x}`) }))"
            data-testid="regra-nivel"
          />
          <div class="campo">
            <label for="regra-desde">{{ t('pep.presc.farmacia.desde') }}</label>
            <input id="regra-desde" v-model="nova.vigenteDesde" type="date" />
          </div>
          <label class="marcar"
            ><input v-model="nova.ativa" type="checkbox" /> {{ t('pep.presc.farmacia.ativa') }}</label
          >
        </div>
        <div class="campo">
          <label for="regra-descricao">{{ t('pep.presc.farmacia.descricao') }}</label>
          <input
            id="regra-descricao"
            v-model="nova.descricao"
            maxlength="500"
            data-testid="regra-descricao"
          />
        </div>
        <div class="campo">
          <label for="regra-justificativa">{{ t('pep.presc.farmacia.justificativa') }}</label>
          <input
            id="regra-justificativa"
            v-model="nova.justificativa"
            maxlength="500"
            data-testid="regra-justificativa"
          />
        </div>
        <div class="campo">
          <label for="regra-senha">{{ t('pep.presc.farmacia.senha') }}</label>
          <input
            id="regra-senha"
            v-model="nova.senha"
            type="password"
            autocomplete="current-password"
            data-testid="regra-senha"
          />
        </div>
        <SanteBotao :rotulo="t('pep.presc.farmacia.gravar')" tipo="submit" data-testid="gravar-regra" />
        <SanteAlerta v-if="ok" variante="info" :texto="ok" anunciar data-testid="regra-ok" />
      </form>

      <form class="bloco" data-testid="simulador" @submit.prevent="fazerSimulacao">
        <h2>{{ t('pep.presc.farmacia.simulador') }}</h2>
        <div class="campo">
          <label for="sim-produtos">{{ t('pep.presc.farmacia.simularProdutos') }}</label>
          <textarea id="sim-produtos" v-model="textoProdutos" rows="3" data-testid="sim-produtos" />
        </div>
        <div class="campo">
          <label for="sim-alergias">{{ t('pep.presc.farmacia.simularAlergias') }}</label>
          <input id="sim-alergias" v-model="textoAlergias" maxlength="200" />
        </div>
        <SanteBotao
          :rotulo="t('pep.presc.farmacia.simular')"
          tipo="submit"
          variante="secundario"
          data-testid="simular"
        />
        <template v-if="resultado">
          <SanteAlerta
            :variante="resultado.impede ? 'alerta' : 'info'"
            :texto="
              resultado.impede
                ? t('pep.presc.farmacia.resultadoImpede')
                : t('pep.presc.farmacia.resultadoLibera')
            "
            data-testid="resultado-simulacao"
          />
          <ul>
            <li v-for="a in resultado.alertas" :key="a.id + a.item">
              {{ t(`pep.presc.alertas.niveis.${a.nivel}`) }} · {{ a.titulo }} · {{ a.detalhe }}
            </li>
          </ul>
        </template>
      </form>
      <MensagemErro v-if="erro" :erro="erro" />
    </template>
    <!-- M24 (P-CAD-1): as tabelas do cadastro no CRUD genérico (a gravação desligada aparece com o motivo). -->
    <section class="bloco" data-testid="edicao-interacoes" :aria-label="t('pep.presc.cadastros.edicao')">
      <GrupoDominiosTela subitem="prescricaoInteracoes" embutida />
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
input,
textarea {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  min-height: var(--sgh-alvo-minimo);
  max-width: 48rem;
}
.marcar {
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  min-height: var(--sgh-alvo-minimo);
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
h2 {
  margin: 0;
}
</style>
