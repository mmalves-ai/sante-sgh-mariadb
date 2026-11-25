<script setup lang="ts">
// Regras de campo do cadastro do paciente (F3.1, 02-CAD linha 2): quais campos são obrigatórios, opcionais, ocultos ou
// somente leitura por módulo, tipo de atendimento e fonte pagadora. Numa tela só: a lista das regras (com as inativas
// sob pedido) e o formulário de inclusão; gravar no mesmo escopo atualiza a regra existente, e inativar nunca apaga.
// A validação aparece na hora (campo sempre exigido pelo cadastro não vira opcional nem oculto); o servidor confere
// tudo de novo pela regra do domínio. Acesso pelo nível do cargo: ler (config.parametro.ler), gravar e inativar
// (config.parametro.editar). Na mesma tela, o canal de entrada de cada módulo de recepção (CanalModuloRecepcaoPainel).
import { tipoDoProblema } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { pode } from '../../../casca/sessao/pode.js';
import { gravarRegraCampo, inativarRegraCampo, lerRegrasCampo } from '../api-ficha-complementar.js';
import CanalModuloRecepcaoPainel from '../componentes/CanalModuloRecepcaoPainel.vue';

// Os mesmos campos e exigências do domínio (dominio-cadastro, regras-campo.ts).
const CAMPOS: Readonly<Record<string, string>> = {
  nome: 'Nome',
  nascimento: 'Data de nascimento',
  sexo: 'Sexo',
  cpf: 'CPF',
  naturalidade: 'Naturalidade',
  cep: 'CEP',
  nomeMae: 'Nome da mãe',
  ufNaturalidade: 'UF da naturalidade',
  logradouro: 'Logradouro',
  numero: 'Número',
  complemento: 'Complemento',
  bairro: 'Bairro',
  celular: 'Celular',
  telefone: 'Telefone',
  email: 'E-mail',
  contatoNome: 'Nome do contato',
  contatoTelefone: 'Telefone do contato',
};
const FIXOS = ['nome', 'nascimento', 'sexo', 'cpf', 'naturalidade', 'cep'];
const EXIGENCIAS = ['obrigatorio', 'opcional', 'oculto', 'somente_leitura'] as const;
const TIPOS = ['todos', 'ambulatorial', 'urgencia', 'internacao', 'externo', 'domiciliar'] as const;

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Campos obrigatórios do cadastro do paciente',
      explica:
        'A regra mais específica vale: fonte pagadora, depois tipo de atendimento, depois módulo, depois o estabelecimento e por fim toda a rede.',
      campo: 'Campo',
      exigencia: 'Exigência',
      tipoAtendimento: 'Tipo de atendimento',
      modulo: 'Módulo de recepção (código; vazio: todos)',
      fonte: 'Fonte pagadora (código; vazio: todas)',
      rotulo: 'Rótulo na tela (vazio: o padrão)',
      todaRede: 'Vale para toda a rede (sem marcar: só este estabelecimento)',
      gravar: 'Gravar regra',
      inativar: 'Inativar',
      mostrarInativas: 'Mostrar as inativas',
      escopo: 'Escopo',
      rede: 'toda a rede',
      estab: 'estabelecimento {id}',
      mod: 'módulo {id}',
      fp: 'fonte {id}',
      inativa: 'inativa',
      vazio: 'Nenhuma regra: valem só os campos sempre exigidos pelo cadastro.',
      gravado: 'Regra gravada.',
      inativada: 'Regra inativada.',
      erro: {
        fixo: 'Este campo é sempre exigido pelo cadastro: só pode ser obrigatório ou somente leitura.',
        codigo: 'Código com até 15 dígitos.',
      },
      exig: {
        obrigatorio: 'Obrigatório',
        opcional: 'Opcional',
        oculto: 'Oculto',
        somente_leitura: 'Somente leitura',
      },
      tipos: {
        todos: 'Todos',
        ambulatorial: 'Ambulatorial',
        urgencia: 'Urgência',
        internacao: 'Internação',
        externo: 'Externo',
        domiciliar: 'Domiciliar',
      },
    },
  },
});

const podeEditar = computed(() => pode('config.parametro.editar'));
const inativas = ref(false);
const cliente = useQueryClient();
const regras = useQuery({
  queryKey: computed(() => ['cadastro', 'regras-campo', inativas.value]),
  queryFn: () => lerRegrasCampo(inativas.value),
});

const form = ref({
  campo: 'nomeMae',
  exigencia: 'obrigatorio' as (typeof EXIGENCIAS)[number],
  tipoAtendimento: 'todos' as (typeof TIPOS)[number],
  modulo: '',
  fontePagadora: '',
  rotulo: '',
  todaRede: false,
});
const codigoValido = (v: string) => v.trim() === '' || /^\d{1,15}$/.test(v.trim());
const erros = computed(() => {
  const e: string[] = [];
  if (FIXOS.includes(form.value.campo) && ['opcional', 'oculto'].includes(form.value.exigencia))
    e.push(t('erro.fixo'));
  if (!codigoValido(form.value.modulo) || !codigoValido(form.value.fontePagadora)) e.push(t('erro.codigo'));
  return e;
});

const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const gravando = ref(false);
async function executar(fn: () => Promise<unknown>, ok: string): Promise<boolean> {
  if (gravando.value) return false;
  gravando.value = true;
  recusa.value = null;
  erro.value = null;
  aviso.value = null;
  try {
    await fn();
    aviso.value = ok;
    await cliente.invalidateQueries({ queryKey: ['cadastro', 'regras-campo'] });
    return true;
  } catch (e) {
    const tipo = e instanceof ErroApi && e.problema ? tipoDoProblema(e.problema) : null;
    if ((tipo === 'recusa-de-negocio' || tipo === 'entrada-invalida') && e instanceof ErroApi && e.problema)
      recusa.value = e.problema.detail ?? e.problema.title ?? '';
    else erro.value = e;
    return false;
  } finally {
    gravando.value = false;
  }
}

async function gravar(): Promise<void> {
  if (erros.value.length) return;
  const f = form.value;
  const ok = await executar(
    () =>
      gravarRegraCampo({
        campo: f.campo,
        exigencia: f.exigencia,
        tipoAtendimento: f.tipoAtendimento,
        modulo: f.modulo.trim() ? Number(f.modulo.trim()) : null,
        fontePagadora: f.fontePagadora.trim() ? Number(f.fontePagadora.trim()) : null,
        rotulo: f.rotulo.trim() || null,
        todaRede: f.todaRede,
      }),
    t('gravado'),
  );
  if (ok) form.value = { ...form.value, rotulo: '' };
}

const escopo = (r: {
  estabelecimento: number | null;
  modulo: number | null;
  fontePagadora: number | null;
  tipoAtendimento: string;
}) =>
  [
    r.estabelecimento === null ? t('rede') : t('estab', { id: r.estabelecimento }),
    r.modulo === null ? null : t('mod', { id: r.modulo }),
    r.tipoAtendimento === 'todos' ? null : t(`tipos.${r.tipoAtendimento}`),
    r.fontePagadora === null ? null : t('fp', { id: r.fontePagadora }),
  ]
    .filter((x) => x !== null)
    .join(' · ');
</script>

<template>
  <section class="tela" aria-labelledby="regras-campo-titulo" data-testid="tela-regras-campo">
    <h1 id="regras-campo-titulo">{{ t('titulo') }}</h1>
    <p>{{ t('explica') }}</p>
    <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" data-testid="recusa-regra" />
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" data-testid="aviso-regra" />
    <MensagemErro v-if="erro" :erro="erro" />

    <form v-if="podeEditar" class="barra" data-testid="form-regra" @submit.prevent="gravar">
      <SanteSelecao
        v-model="form.campo"
        :rotulo="t('campo')"
        :opcoes="Object.entries(CAMPOS).map(([valor, rotulo]) => ({ valor, rotulo }))"
        data-testid="regra-campo"
      />
      <SanteSelecao
        v-model="form.exigencia"
        :rotulo="t('exigencia')"
        :opcoes="EXIGENCIAS.map((valor) => ({ valor, rotulo: t(`exig.${valor}`) }))"
        data-testid="regra-exigencia"
      />
      <SanteSelecao
        v-model="form.tipoAtendimento"
        :rotulo="t('tipoAtendimento')"
        :opcoes="TIPOS.map((valor) => ({ valor, rotulo: t(`tipos.${valor}`) }))"
        data-testid="regra-tipo"
      />
      <label
        >{{ t('modulo') }}
        <input v-model="form.modulo" inputmode="numeric" maxlength="15" data-testid="regra-modulo"
      /></label>
      <label
        >{{ t('fonte') }}
        <input v-model="form.fontePagadora" inputmode="numeric" maxlength="15" data-testid="regra-fonte"
      /></label>
      <label
        >{{ t('rotulo') }} <input v-model="form.rotulo" maxlength="60" data-testid="regra-rotulo"
      /></label>
      <label
        ><input v-model="form.todaRede" type="checkbox" data-testid="regra-rede" /> {{ t('todaRede') }}</label
      >
      <p v-for="x in erros" :key="x" class="erro-campo" role="alert">{{ x }}</p>
      <SanteBotao
        :rotulo="t('gravar')"
        variante="primario"
        tipo="submit"
        :desabilitado="gravando || erros.length > 0"
        data-testid="regra-gravar"
      />
    </form>

    <label class="filtro"
      ><input v-model="inativas" type="checkbox" data-testid="regras-inativas" />
      {{ t('mostrarInativas') }}</label
    >
    <p v-if="regras.data.value && !regras.data.value.itens.length">{{ t('vazio') }}</p>
    <table v-else-if="regras.data.value" data-testid="lista-regras">
      <thead>
        <tr>
          <th scope="col">{{ t('campo') }}</th>
          <th scope="col">{{ t('exigencia') }}</th>
          <th scope="col">{{ t('escopo') }}</th>
          <th scope="col">
            <span class="visualmente-oculto">{{ t('inativar') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in regras.data.value.itens" :key="r.id" :data-testid="`regra-${r.id}`">
          <td>{{ r.rotulo || CAMPOS[r.campo] || r.campo }}</td>
          <td>
            {{ t(`exig.${r.exigencia}`) }}<span v-if="!r.ativo"> · {{ t('inativa') }}</span>
          </td>
          <td>{{ escopo(r) }}</td>
          <td>
            <SanteBotao
              v-if="podeEditar && r.ativo"
              :rotulo="t('inativar')"
              :data-testid="`regra-inativar-${r.id}`"
              @acionar="executar(() => inativarRegraCampo(r.id, r.versao), t('inativada'))"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <CanalModuloRecepcaoPainel />
  </section>
</template>

<style scoped>
.barra {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sante-espaco-2, 0.5rem);
  align-items: flex-end;
}
.filtro {
  display: block;
  margin-block: var(--sante-espaco-2, 0.5rem);
}
.erro-campo {
  color: var(--sgh-alerta);
  width: 100%;
}
.visualmente-oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
