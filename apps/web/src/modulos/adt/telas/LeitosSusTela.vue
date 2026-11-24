<script setup lang="ts">
// Leitos do sistema público (F78.04-2, 04-INT linha 79): `/internacao/leitos-sus`. Duas abas: a habilitação (portaria,
// vigência, quantidade) com os leitos do programa, e a capacidade contratada por competência com o teto de diárias e
// o histórico. A validação roda na hora pela mesma regra do domínio que a API aplica; nada é apagado.
import {
  competenciaDe,
  conferirCapacidadeSus,
  conferirHabilitacaoLeitoSus,
  TIPOS_ATENDIMENTO_LEITO_SUS,
  type TipoAtendimentoLeitoSus,
} from '@sgh/dominio-internacao';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  encerrarHabilitacaoSus,
  encerrarLeitoPrograma,
  incluirHabilitacaoSus,
  lerCapacidadeSus,
  lerHabilitacoesSus,
  lerLeitosPrograma,
  registrarCapacidadeSus,
  vincularLeitoPrograma,
} from '../api-leitos-sus.js';
import ErroAdt from '../componentes/ErroAdt.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const hoje = () => new Date().toISOString().slice(0, 10);
const aba = ref<'habilitacoes' | 'capacidade'>('habilitacoes');
const habilitacoes = useQuery({
  queryKey: ['adt', 'leitos-sus', 'habilitacoes'],
  queryFn: lerHabilitacoesSus,
});
const selecionada = ref<number | null>(null);
const leitos = useQuery({
  queryKey: computed(() => ['adt', 'leitos-sus', 'leitos', selecionada.value]),
  queryFn: () => lerLeitosPrograma(selecionada.value!),
  enabled: computed(() => selecionada.value !== null),
});
const competencia = ref(hoje().slice(0, 7));
const comp = computed(() => competenciaDe(competencia.value));
const capacidade = useQuery({
  queryKey: computed(() => ['adt', 'leitos-sus', 'capacidade', comp.value]),
  queryFn: () => lerCapacidadeSus(comp.value!),
  enabled: computed(() => !!comp.value),
});

const h = reactive({
  codigo: '',
  nome: '',
  numeroPortaria: '',
  dataPortaria: '',
  vigenciaInicio: hoje(),
  vigenciaFim: '',
  quantidadeLeitosHabilitados: null as number | null,
  tipoAtendimento: 'internacao' as TipoAtendimentoLeitoSus,
  permiteUsoForaPrograma: false,
  avisaUsuario: false,
});
const opTipos = computed(() =>
  TIPOS_ATENDIMENTO_LEITO_SUS.map((v) => ({ valor: v, rotulo: t(`adt.leitosSus.tipos.${v}`) })),
);
const corpoHab = () => ({
  ...h,
  numeroPortaria: h.numeroPortaria.trim() || null,
  dataPortaria: h.dataPortaria || null,
  vigenciaFim: h.vigenciaFim || null,
  quantidadeLeitosHabilitados: h.quantidadeLeitosHabilitados || null,
});
const problemasHab = computed(() => conferirHabilitacaoLeitoSus(corpoHab()).map((p) => p.mensagem));

const v = reactive({ leito: null as number | null, vigenciaInicio: hoje() });
const cap = reactive({ especialidade: null as number | null, quantidadeLeitos: 0, criticaLiberada: false });
const vigenteDe = (esp: number | null) =>
  capacidade.data.value?.itens.find((x) => x.especialidade === esp) ?? null;
const problemasCap = computed(() => {
  if (!comp.value || !cap.especialidade) return [];
  const atual = vigenteDe(cap.especialidade);
  return conferirCapacidadeSus({
    competencia: comp.value,
    quantidadeLeitos: Number(cap.quantidadeLeitos),
    criticaLiberada: cap.criticaLiberada,
    excluir: false,
    vigente: atual
      ? {
          id: 0,
          especialidade: atual.especialidade,
          competencia: comp.value,
          quantidadeLeitos: atual.quantidadeLeitos,
          criticaLiberada: atual.criticaLiberada,
          operacao: 'alteracao',
          ocorridoEm: '',
        }
      : null,
  }).problemas.map((p) => p.mensagem);
});

const erro = ref<unknown>(null);
const aviso = ref('');
const acao = useMutation({
  mutationFn: (fn: () => Promise<unknown>) => fn(),
  onSuccess: () => {
    erro.value = null;
    aviso.value = t('adt.leitosSus.salvo');
    void cliente.invalidateQueries({ queryKey: ['adt', 'leitos-sus'] });
  },
  onError: (e) => {
    erro.value = e;
  },
});
</script>

<template>
  <section class="tela-agenda" aria-labelledby="leitos-sus-titulo" data-testid="tela-leitos-sus">
    <h1 id="leitos-sus-titulo">{{ t('adt.leitosSus.titulo') }}</h1>
    <p>{{ t('adt.leitosSus.texto') }}</p>
    <div role="tablist">
      <button
        v-for="a in ['habilitacoes', 'capacidade'] as const"
        :key="a"
        type="button"
        role="tab"
        :aria-selected="aba === a"
        :data-testid="`leitos-sus-aba-${a}`"
        @click="aba = a"
      >
        {{ t(`adt.leitosSus.abas.${a}`) }}
      </button>
    </div>
    <ErroAdt v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="leitos-sus-aviso">{{ aviso }}</p>

    <template v-if="aba === 'habilitacoes'">
      <ErroAdt v-if="habilitacoes.isError.value" :erro="habilitacoes.error.value" />
      <form
        class="filtros"
        data-testid="habilitacao-sus-form"
        @submit.prevent="acao.mutate(() => incluirHabilitacaoSus(corpoHab()))"
      >
        <label
          >{{ t('adt.leitosSus.codigo') }}
          <input v-model="h.codigo" maxlength="30" required data-testid="hab-codigo"
        /></label>
        <label
          >{{ t('adt.leitosSus.nome') }}
          <input v-model="h.nome" maxlength="150" required data-testid="hab-nome"
        /></label>
        <label
          >{{ t('adt.leitosSus.portaria') }}
          <input v-model="h.numeroPortaria" maxlength="60" data-testid="hab-portaria"
        /></label>
        <label
          >{{ t('adt.leitosSus.dataPortaria') }}
          <input v-model="h.dataPortaria" type="date" data-testid="hab-data-portaria"
        /></label>
        <label
          >{{ t('adt.leitosSus.inicio') }}
          <input v-model="h.vigenciaInicio" type="date" required data-testid="hab-inicio"
        /></label>
        <label
          >{{ t('adt.leitosSus.fim') }} <input v-model="h.vigenciaFim" type="date" data-testid="hab-fim"
        /></label>
        <label
          >{{ t('adt.leitosSus.quantidade') }}
          <input
            v-model.number="h.quantidadeLeitosHabilitados"
            type="number"
            min="1"
            data-testid="hab-quantidade"
        /></label>
        <SanteSelecao
          v-model="h.tipoAtendimento"
          :rotulo="t('adt.leitosSus.tipoAtendimento')"
          :opcoes="opTipos"
          data-testid="hab-tipo"
        />
        <label
          ><input v-model="h.permiteUsoForaPrograma" type="checkbox" />
          {{ t('adt.leitosSus.foraPrograma') }}</label
        >
        <label v-if="h.permiteUsoForaPrograma"
          ><input v-model="h.avisaUsuario" type="checkbox" /> {{ t('adt.leitosSus.avisa') }}</label
        >
        <ul v-if="problemasHab.length" class="problemas" data-testid="hab-problemas">
          <li v-for="p in problemasHab" :key="p">{{ p }}</li>
        </ul>
        <button
          type="submit"
          :disabled="problemasHab.length > 0 || acao.isPending.value"
          data-testid="hab-incluir"
        >
          {{ t('adt.leitosSus.incluir') }}
        </button>
      </form>
      <p v-if="habilitacoes.data.value?.itens.length === 0">{{ t('adt.leitosSus.vazio') }}</p>
      <table v-else-if="habilitacoes.data.value" data-testid="habilitacoes-sus">
        <thead>
          <tr>
            <th>{{ t('adt.leitosSus.codigo') }}</th>
            <th>{{ t('adt.leitosSus.nome') }}</th>
            <th>{{ t('adt.leitosSus.portaria') }}</th>
            <th>{{ t('adt.leitosSus.inicio') }}</th>
            <th>{{ t('adt.leitosSus.fim') }}</th>
            <th>{{ t('adt.leitosSus.noPrograma') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in habilitacoes.data.value.itens" :key="x.id">
            <td>{{ x.codigo }}</td>
            <td>{{ x.nome }}</td>
            <td>{{ x.numeroPortaria ?? '—' }}</td>
            <td>{{ x.vigenciaInicio }}</td>
            <td>{{ x.vigenciaFim ?? '—' }}</td>
            <td>{{ x.leitosNoPrograma }} / {{ x.quantidadeLeitosHabilitados ?? '—' }}</td>
            <td>
              <button type="button" :data-testid="`hab-ver-${x.codigo}`" @click="selecionada = x.id">
                {{ t('adt.leitosSus.verLeitos') }}
              </button>
              <button
                v-if="!x.vigenciaFim"
                type="button"
                @click="acao.mutate(() => encerrarHabilitacaoSus(x.id, x.versao, hoje()))"
              >
                {{ t('adt.leitosSus.encerrar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <fieldset v-if="selecionada !== null" data-testid="leitos-programa">
        <legend>{{ t('adt.leitosSus.verLeitos') }}</legend>
        <form
          class="filtros"
          @submit.prevent="
            acao.mutate(() =>
              vincularLeitoPrograma(selecionada!, { leito: v.leito!, vigenciaInicio: v.vigenciaInicio }),
            )
          "
        >
          <label
            >{{ t('adt.leitosSus.leito') }}
            <input v-model.number="v.leito" type="number" min="1" required data-testid="vinculo-leito"
          /></label>
          <label
            >{{ t('adt.leitosSus.entrada') }} <input v-model="v.vigenciaInicio" type="date" required
          /></label>
          <button type="submit" :disabled="!v.leito" data-testid="vinculo-incluir">
            {{ t('adt.leitosSus.vincular') }}
          </button>
        </form>
        <ul>
          <li
            v-for="l in leitos.data.value?.itens ?? []"
            :key="l.id"
            :data-testid="`vinculo-${l.leitoCodigo}`"
          >
            {{ l.leitoCodigo }}: {{ l.vigenciaInicio }} — {{ l.vigenciaFim ?? t('adt.leitosSus.vigente') }}
            <button
              v-if="!l.vigenciaFim"
              type="button"
              @click="acao.mutate(() => encerrarLeitoPrograma(l.id, l.versao, hoje()))"
            >
              {{ t('adt.leitosSus.sair') }}
            </button>
          </li>
        </ul>
      </fieldset>
    </template>

    <template v-else>
      <label
        >{{ t('adt.leitosSus.competencia') }}
        <input v-model="competencia" type="month" data-testid="cap-competencia"
      /></label>
      <ErroAdt v-if="capacidade.isError.value" :erro="capacidade.error.value" />
      <form
        class="filtros"
        data-testid="capacidade-sus-form"
        @submit.prevent="
          acao.mutate(() =>
            registrarCapacidadeSus({
              especialidade: cap.especialidade!,
              competencia: comp!,
              quantidadeLeitos: Number(cap.quantidadeLeitos),
              criticaLiberada: cap.criticaLiberada,
              excluir: false,
            }),
          )
        "
      >
        <label
          >{{ t('adt.leitosSus.especialidade') }}
          <input
            v-model.number="cap.especialidade"
            type="number"
            min="1"
            required
            data-testid="cap-especialidade"
        /></label>
        <label
          >{{ t('adt.leitosSus.quantidadeLeitos') }}
          <input
            v-model.number="cap.quantidadeLeitos"
            type="number"
            min="0"
            max="9999"
            data-testid="cap-quantidade"
        /></label>
        <label
          ><input v-model="cap.criticaLiberada" type="checkbox" /> {{ t('adt.leitosSus.liberada') }}</label
        >
        <ul v-if="problemasCap.length" class="problemas">
          <li v-for="p in problemasCap" :key="p">{{ p }}</li>
        </ul>
        <button
          type="submit"
          :disabled="!cap.especialidade || problemasCap.length > 0"
          data-testid="cap-registrar"
        >
          {{ t('adt.leitosSus.registrar') }}
        </button>
      </form>
      <p v-if="capacidade.data.value?.itens.length === 0">{{ t('adt.leitosSus.vazio') }}</p>
      <table v-else-if="capacidade.data.value" data-testid="capacidade-sus">
        <thead>
          <tr>
            <th>{{ t('adt.leitosSus.especialidade') }}</th>
            <th>{{ t('adt.leitosSus.quantidadeLeitos') }}</th>
            <th>{{ t('adt.leitosSus.teto') }}</th>
            <th>{{ t('adt.leitosSus.historico') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in capacidade.data.value.itens" :key="x.especialidade">
            <td>{{ x.especialidadeDescricao }}</td>
            <td>{{ x.quantidadeLeitos }}{{ x.criticaLiberada ? ' *' : '' }}</td>
            <td>{{ x.tetoDiarias }}</td>
            <td>
              <span v-for="hh in x.historico" :key="hh.id">
                {{
                  `${t(`adt.leitosSus.operacoes.${hh.operacao}`)} ${hh.quantidadeLeitos} (${hh.ocorridoEm.slice(0, 10)}); `
                }}
              </span>
            </td>
            <td>
              <button
                v-if="x.quantidadeLeitos > 0"
                type="button"
                @click="
                  acao.mutate(() =>
                    registrarCapacidadeSus({
                      especialidade: x.especialidade,
                      competencia: comp!,
                      quantidadeLeitos: 0,
                      criticaLiberada: false,
                      excluir: true,
                    }),
                  )
                "
              >
                {{ t('adt.leitosSus.retirar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>
