<script setup lang="ts">
// 02-REC linha 37: a elegibilidade do beneficiário e a senha de autorização na tela de abertura, antes de abrir o
// atendimento. Mostra as carteiras do paciente com a última consulta de elegibilidade, consulta a operadora em um clique
// (pelo serviço web dela quando cadastrado; senão a consulta fica registrada para a resposta à mão) e colhe a senha de
// autorização e a validade dela, que a regra do plano exige por fonte pagadora, especialidade, serviço e setor.
import { SanteAlerta, SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import {
  consultarElegibilidade,
  type ElegibilidadePaciente,
  lerElegibilidade,
  lerRetornoElegibilidade,
} from '../../tiss/api-elegibilidade.js';

const props = defineProps<{ paciente: number | null }>();
const senha = defineModel<string>('senha', { required: true });
const validadeSenha = defineModel<string>('validadeSenha', { required: true });

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Elegibilidade e senha da operadora',
      senha: 'Senha de autorização',
      validadeSenha: 'Validade da senha',
      semCarteira: 'O paciente não tem carteira de convênio cadastrada.',
      nunca: 'nunca consultada',
      elegivel: 'elegível',
      negado: 'não elegível',
      ultima: 'Última consulta: {quando} ({situacao})',
      consultar: 'Consultar elegibilidade',
      lerRetorno: 'Ler o retorno da operadora',
      enviada: 'Consulta enviada à operadora; leia o retorno em seguida.',
      registrada: 'Consulta registrada: a resposta da operadora é lançada na tela de elegibilidade.',
      reaproveitada: 'A consulta de hoje foi reaproveitada.',
      resultadoElegivel: 'Beneficiário elegível. Código de validação: {codigo}',
      resultadoNegado: 'Beneficiário não elegível: {motivo}',
      responder: 'Lançar a resposta da operadora',
      erro: 'Não foi possível consultar a elegibilidade agora; a abertura segue com a conferência da regra do plano.',
    },
  },
});

const dados = ref<ElegibilidadePaciente | null>(null);
const aviso = ref<string | null>(null);
const falha = ref(false);
const ocupado = ref(false);
const podeConsultar = computed(() => pode('atendimento.segurado.editar'));

async function carregar(): Promise<void> {
  falha.value = false;
  if (props.paciente === null) {
    dados.value = null;
    return;
  }
  try {
    dados.value = await lerElegibilidade(props.paciente);
  } catch {
    dados.value = null;
    falha.value = true;
  }
}
watch(
  () => props.paciente,
  () => {
    aviso.value = null;
    void carregar();
  },
  { immediate: true },
);

/** A consulta mais recente de cada carteira (pela fonte e pelo número), para o resultado na linha. */
const ultimaDe = (fonte: string, carteira: string | null) =>
  dados.value?.consultas.find((c) => c.fontePagadora === fonte && c.carteira === carteira) ?? null;
const situacaoDe = (aprovada: boolean | null) =>
  aprovada === null ? t('nunca') : aprovada ? t('elegivel') : t('negado');

async function consultar(cobertura: number): Promise<void> {
  ocupado.value = true;
  aviso.value = null;
  try {
    const r = await consultarElegibilidade(cobertura);
    aviso.value = r.reaproveitada ? t('reaproveitada') : r.enviada ? t('enviada') : t('registrada');
    await carregar();
  } catch {
    falha.value = true;
  } finally {
    ocupado.value = false;
  }
}
async function lerRetorno(id: number): Promise<void> {
  ocupado.value = true;
  try {
    await lerRetornoElegibilidade(id);
    await carregar();
  } catch {
    falha.value = true;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section
    class="elegibilidade-abertura"
    aria-labelledby="eleg-abertura-titulo"
    data-testid="elegibilidade-abertura"
  >
    <h2 id="eleg-abertura-titulo">{{ t('titulo') }}</h2>
    <template v-if="paciente !== null && dados">
      <p v-if="dados.coberturas.length === 0" class="secundario">{{ t('semCarteira') }}</p>
      <ul v-else class="lista-simples">
        <li v-for="c in dados.coberturas" :key="c.id" data-testid="elegibilidade-cobertura">
          <strong>{{ c.fontePagadora }}</strong> · {{ c.carteira ?? '—' }} ·
          {{
            t('ultima', {
              quando: c.ultimaElegibilidadeEm ?? '—',
              situacao: situacaoDe(c.ultimaAprovada),
            })
          }}
          <template v-for="u in [ultimaDe(c.fontePagadora, c.carteira)]" :key="u?.id ?? 0">
            <p v-if="u && u.situacao === 'elegivel'" data-testid="elegibilidade-resultado">
              {{ t('resultadoElegivel', { codigo: u.codigoValidacao ?? '—' }) }}
            </p>
            <p v-else-if="u && u.motivoNegativa" data-testid="elegibilidade-resultado">
              {{ t('resultadoNegado', { motivo: u.motivoNegativa }) }}
            </p>
            <SanteBotao
              v-if="u && u.pelaOperadora && u.respondidaEm === null"
              variante="secundario"
              :desabilitado="ocupado"
              data-testid="elegibilidade-ler-retorno"
              @click="lerRetorno(u.id)"
              :rotulo="t('lerRetorno')"
            />
            <RouterLink
              v-else-if="u && !u.pelaOperadora && u.respondidaEm === null"
              :to="{ path: '/faturamento/elegibilidade', query: { paciente: String(paciente) } }"
              >{{ t('responder') }}</RouterLink
            >
          </template>
          <SanteBotao
            v-if="podeConsultar"
            variante="secundario"
            :desabilitado="ocupado"
            data-testid="elegibilidade-consultar"
            @click="consultar(c.id)"
            :rotulo="t('consultar')"
          />
        </li>
      </ul>
    </template>
    <SanteAlerta v-if="aviso" variante="info" :texto="aviso" data-testid="elegibilidade-aviso" />
    <SanteAlerta v-if="falha" variante="alerta" :texto="t('erro')" />
    <div class="grade-campos">
      <SanteCampoTexto
        v-model="senha"
        :rotulo="t('senha')"
        :max-bytes="20"
        data-testid="abrir-senha-convenio"
      />
      <div class="campo">
        <label for="abrir-atd-val-senha">{{ t('validadeSenha') }}</label>
        <input
          id="abrir-atd-val-senha"
          v-model="validadeSenha"
          type="date"
          data-testid="abrir-validade-senha"
        />
      </div>
    </div>
  </section>
</template>
